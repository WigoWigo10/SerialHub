use super::*;
use rustls::{ClientConnection, ServerConfig, ServerConnection, StreamOwned};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

fn fixture(name: &str) -> String {
    format!(
        "{}/src/commands/mqtt_transport/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    )
}

fn configured(mode: MqttTransport, port: u16) -> Result<MqttOptions, String> {
    options(
        "test",
        "localhost",
        port,
        mode,
        Some(&fixture("ca.pem")),
        None,
        None,
        Some("/mqtt"),
    )
}

fn client_config(options: &MqttOptions) -> Arc<ClientConfig> {
    match options.transport() {
        Transport::Tls(TlsConfiguration::Rustls(config))
        | Transport::Wss(TlsConfiguration::Rustls(config)) => config,
        _ => panic!("secure transport required"),
    }
}

#[test]
fn all_four_modes_are_explicit_and_independent_of_port() {
    for port in [1883, 8883, 443, 8000, 12345] {
        for mode in [
            MqttTransport::Tcp,
            MqttTransport::Tls,
            MqttTransport::Ws,
            MqttTransport::Wss,
        ] {
            let ca = mode.secure().then(|| fixture("ca.pem"));
            let result = options(
                "test",
                "localhost",
                port,
                mode,
                ca.as_deref(),
                None,
                None,
                None,
            )
            .unwrap();
            assert!(matches!(
                (mode, result.transport()),
                (MqttTransport::Tcp, Transport::Tcp)
                    | (MqttTransport::Tls, Transport::Tls(_))
                    | (MqttTransport::Ws, Transport::Ws)
                    | (MqttTransport::Wss, Transport::Wss(_))
            ));
            assert_eq!(result.broker_address().1, port);
        }
    }
}

#[test]
fn hostname_and_websocket_path_are_preserved_without_ipv4_replacement() {
    let tls = options(
        "test",
        "broker.example",
        1883,
        MqttTransport::Tls,
        Some(&fixture("ca.pem")),
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(tls.broker_address(), ("broker.example".to_string(), 1883));
    let ws = options(
        "test",
        "broker.example",
        8883,
        MqttTransport::Wss,
        Some(&fixture("ca.pem")),
        None,
        None,
        Some("/custom?site=1"),
    )
    .unwrap();
    assert_eq!(
        ws.broker_address().0,
        "wss://broker.example:8883/custom?site=1"
    );
    let ipv6 = options(
        "test",
        "::1",
        1883,
        MqttTransport::Ws,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(ipv6.broker_address().0, "ws://[::1]:1883/mqtt");
}

#[test]
fn ca_only_and_complete_mtls_work_and_client_auth_is_optional() {
    assert!(
        !client_config(&configured(MqttTransport::Tls, 8883).unwrap())
            .client_auth_cert_resolver
            .has_certs()
    );
    for mode in [MqttTransport::Tls, MqttTransport::Wss] {
        let value = options(
            "test",
            "localhost",
            1883,
            mode,
            Some(&fixture("ca.pem")),
            Some(&fixture("client.pem")),
            Some(&fixture("client-key.pem")),
            None,
        )
        .unwrap();
        assert!(client_config(&value).client_auth_cert_resolver.has_certs());
    }
}

#[test]
fn missing_client_material_and_tls_files_in_plain_modes_are_rejected() {
    for mode in [
        MqttTransport::Tls,
        MqttTransport::Wss,
        MqttTransport::Tcp,
        MqttTransport::Ws,
    ] {
        assert!(options(
            "test",
            "localhost",
            8883,
            mode,
            None,
            Some("cert.pem"),
            None,
            None
        )
        .is_err());
        assert!(options(
            "test",
            "localhost",
            1883,
            mode,
            None,
            None,
            Some("key.pem"),
            None
        )
        .is_err());
    }
    for mode in [MqttTransport::Tcp, MqttTransport::Ws] {
        assert!(configured(mode, 8883).unwrap_err().contains("TLS"));
    }
}

#[test]
fn invalid_files_or_mismatched_identity_never_produce_plain_transport() {
    for mode in [MqttTransport::Tls, MqttTransport::Wss] {
        assert!(options(
            "test",
            "localhost",
            1883,
            mode,
            Some("does-not-exist.pem"),
            None,
            None,
            None
        )
        .is_err());
        assert!(options(
            "test",
            "localhost",
            1883,
            mode,
            Some(env!("CARGO_MANIFEST_DIR")),
            None,
            None,
            None
        )
        .is_err());
        assert!(options(
            "test",
            "localhost",
            1883,
            mode,
            Some(&fixture("client-key.pem")),
            None,
            None,
            None
        )
        .is_err());
        assert!(options(
            "test",
            "localhost",
            1883,
            mode,
            Some(&fixture("ca.pem")),
            Some(&fixture("client-key.pem")),
            Some(&fixture("client-key.pem")),
            None
        )
        .is_err());
        assert!(options(
            "test",
            "localhost",
            1883,
            mode,
            Some(&fixture("ca.pem")),
            Some(&fixture("client.pem")),
            Some(&fixture("ca.pem")),
            None
        )
        .is_err());
        assert!(options(
            "test",
            "localhost",
            1883,
            mode,
            Some(&fixture("ca.pem")),
            Some(&fixture("client.pem")),
            Some(&fixture("server-key.pem")),
            None
        )
        .unwrap_err()
        .contains("não correspondem"));
    }
    // Malformed DER inside syntactically valid PEM must be rejected as well.
    assert!(certificates(
        b"-----BEGIN CERTIFICATE-----\nAQID\n-----END CERTIFICATE-----\n",
        "test"
    )
    .is_err());
    assert!(certificates(b"not a certificate", "test").is_err());
}

#[test]
fn invalid_host_client_id_port_mode_or_websocket_path_is_rejected() {
    for host in [
        "",
        "host:8883",
        "wss://localhost/mqtt",
        "host/path",
        "host@evil",
        "host bad",
    ] {
        assert!(options(
            "test",
            host,
            1883,
            MqttTransport::Tcp,
            None,
            None,
            None,
            None
        )
        .is_err());
    }
    assert!(options(
        "",
        "localhost",
        1883,
        MqttTransport::Tcp,
        None,
        None,
        None,
        None
    )
    .is_err());
    assert!(options(
        "test",
        "localhost",
        0,
        MqttTransport::Tcp,
        None,
        None,
        None,
        None
    )
    .is_err());
    for path in ["mqtt", "/mqtt#bad", "/mqtt bad", "/\\evil"] {
        assert!(options(
            "test",
            "localhost",
            1883,
            MqttTransport::Ws,
            None,
            None,
            None,
            Some(path)
        )
        .is_err());
    }
    for mode in ["", "ssl", "unknown"] {
        assert!(serde_json::from_str::<MqttTransport>(&format!("\"{mode}\"")).is_err());
    }
}

#[test]
fn absent_custom_ca_uses_system_roots_or_returns_an_explicit_error() {
    // Platform roots can be unavailable on a restricted machine; either result
    // must be explicit and never a downgrade to a non-TLS transport.
    match options(
        "test",
        "localhost",
        1883,
        MqttTransport::Tls,
        None,
        None,
        None,
        None,
    ) {
        Ok(result) => {
            client_config(&result);
        }
        Err(error) => assert!(error.starts_with("TLS:")),
    }
}

fn handshake(client: Arc<ClientConfig>, hostname: &str, mutual: bool) -> bool {
    let roots = || {
        let mut roots = RootCertStore::empty();
        roots
            .add(
                certificates(include_bytes!("fixtures/ca.pem"), "test")
                    .unwrap()
                    .remove(0),
            )
            .unwrap();
        roots
    };
    let builder = ServerConfig::builder();
    let builder = if mutual {
        builder.with_client_cert_verifier(
            rustls::server::WebPkiClientVerifier::builder(Arc::new(roots()))
                .build()
                .unwrap(),
        )
    } else {
        builder.with_no_client_auth()
    };
    let key =
        rustls_pemfile::private_key(&mut Cursor::new(include_bytes!("fixtures/server-key.pem")))
            .unwrap()
            .unwrap();
    let config = builder
        .with_single_cert(
            certificates(include_bytes!("fixtures/server.pem"), "test").unwrap(),
            key,
        )
        .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut stream = StreamOwned::new(ServerConnection::new(Arc::new(config)).unwrap(), socket);
        let mut byte = [0];
        stream
            .read_exact(&mut byte)
            .and_then(|_| stream.write_all(b"OK"))
            .is_ok()
    });
    let socket = TcpStream::connect(address).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    socket
        .set_write_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let name = rustls::pki_types::ServerName::try_from(hostname.to_owned()).unwrap();
    let mut stream = StreamOwned::new(ClientConnection::new(client, name).unwrap(), socket);
    let mut response = [0; 2];
    let accepted = stream
        .write_all(b"x")
        .and_then(|_| stream.read_exact(&mut response))
        .is_ok();
    drop(stream);
    let server_ok = server.join().unwrap();
    accepted && server_ok && response == *b"OK"
}

#[test]
fn loopback_tls_handshakes_require_trusted_ca_and_matching_hostname() {
    assert!(handshake(
        client_config(&configured(MqttTransport::Tls, 1883).unwrap()),
        "localhost",
        false
    ));
    let wrong_ca = options(
        "test",
        "localhost",
        1883,
        MqttTransport::Tls,
        Some(&fixture("other-ca.pem")),
        None,
        None,
        None,
    )
    .unwrap();
    assert!(!handshake(client_config(&wrong_ca), "localhost", false));
    assert!(!handshake(
        client_config(&configured(MqttTransport::Wss, 1883).unwrap()),
        "wrong.example",
        false
    ));
}

#[test]
fn loopback_mutual_tls_accepts_matching_client_and_rejects_missing_identity() {
    let mtls = options(
        "test",
        "localhost",
        1883,
        MqttTransport::Tls,
        Some(&fixture("ca.pem")),
        Some(&fixture("client.pem")),
        Some(&fixture("client-key.pem")),
        None,
    )
    .unwrap();
    assert!(handshake(client_config(&mtls), "localhost", true));
    assert!(!handshake(
        client_config(&configured(MqttTransport::Tls, 1883).unwrap()),
        "localhost",
        true
    ));
}
