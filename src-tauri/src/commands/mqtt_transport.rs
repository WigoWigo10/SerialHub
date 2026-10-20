//! Explicit MQTT transport selection. Configuration errors never downgrade TLS.
use rumqttc::tokio_rustls::rustls::{self, pki_types::CertificateDer, ClientConfig, RootCertStore};
use rumqttc::{MqttOptions, TlsConfiguration, Transport};
use serde::Deserialize;
use std::{fs, io::Cursor, net::IpAddr, sync::Arc};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MqttTransport {
    Tcp,
    Tls,
    Ws,
    Wss,
}

impl MqttTransport {
    fn secure(self) -> bool {
        matches!(self, Self::Tls | Self::Wss)
    }
}

fn nonempty(path: Option<&str>) -> Option<&str> {
    path.filter(|p| !p.trim().is_empty())
}

fn read(path: &str, label: &str) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| format!("TLS: falha ao ler {label} em '{path}': {e}"))
}

fn certificates(bytes: &[u8], label: &str) -> Result<Vec<CertificateDer<'static>>, String> {
    let certs = rustls_pemfile::certs(&mut Cursor::new(bytes))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("TLS: PEM inválido em {label}: {e}"))?;
    if certs.is_empty() {
        return Err(format!("TLS: {label} não contém certificados PEM"));
    }
    for cert in &certs {
        webpki::EndEntityCert::try_from(cert)
            .map_err(|e| format!("TLS: certificado inválido em {label}: {e:?}"))?;
    }
    Ok(certs)
}

fn tls_config(
    ca: Option<&str>,
    cert: Option<&str>,
    key: Option<&str>,
) -> Result<ClientConfig, String> {
    let mut roots = RootCertStore::empty();
    let root_certs = if let Some(path) = ca {
        certificates(&read(path, "CA")?, "CA")?
    } else {
        rustls_native_certs::load_native_certs()
            .map_err(|e| format!("TLS: falha ao carregar raízes do sistema: {e}"))?
    };
    for cert in root_certs {
        roots
            .add(cert)
            .map_err(|e| format!("TLS: raiz de confiança inválida: {e}"))?;
    }
    if roots.is_empty() {
        return Err("TLS: nenhuma raiz confiável disponível; informe uma CA PEM".into());
    }
    let builder = ClientConfig::builder().with_root_certificates(roots);
    match (cert, key) {
        (Some(cert_path), Some(key_path)) => {
            let chain = certificates(
                &read(cert_path, "certificado do cliente")?,
                "certificado do cliente",
            )?;
            let bytes = read(key_path, "chave do cliente")?;
            let key = rustls_pemfile::private_key(&mut Cursor::new(bytes))
                .map_err(|e| format!("TLS: PEM da chave inválido: {e}"))?
                .ok_or(
                    "TLS: chave PEM ausente ou criptografada; use chave privada não criptografada",
                )?;
            // Rustls 0.22 parses the key but does not check its match to the leaf.
            // Sign a local challenge and verify it with the certificate public key.
            let signing = rustls::crypto::ring::sign::any_supported_type(&key)
                .map_err(|e| format!("TLS: chave privada inválida: {e}"))?;
            let algorithms =
                rustls::crypto::ring::default_provider().signature_verification_algorithms;
            let signer = signing
                .choose_scheme(&algorithms.supported_schemes())
                .ok_or("TLS: algoritmo da chave não suportado")?;
            let challenge = b"SerialHub local certificate/key consistency check";
            let signature = signer
                .sign(challenge)
                .map_err(|e| format!("TLS: não foi possível validar a chave: {e}"))?;
            let leaf = webpki::EndEntityCert::try_from(&chain[0])
                .map_err(|e| format!("TLS: certificado do cliente inválido: {e:?}"))?;
            let matches = algorithms
                .mapping
                .iter()
                .filter(|(scheme, _)| *scheme == signer.scheme())
                .any(|(_, algs)| {
                    algs.iter()
                        .any(|alg| leaf.verify_signature(*alg, challenge, &signature).is_ok())
                });
            if !matches {
                return Err("TLS: certificado e chave do cliente não correspondem".into());
            }
            builder
                .with_client_auth_cert(chain, key)
                .map_err(|e| format!("TLS: identidade do cliente inválida: {e}"))
        }
        (None, None) => Ok(builder.with_no_client_auth()),
        _ => Err("TLS: informe certificado e chave do cliente em conjunto".into()),
    }
}

pub fn options(
    client_id: &str,
    host: &str,
    port: u16,
    mode: MqttTransport,
    ca: Option<&str>,
    cert: Option<&str>,
    key: Option<&str>,
    websocket_path: Option<&str>,
) -> Result<MqttOptions, String> {
    if client_id.trim().is_empty() {
        return Err("Informe o Client ID MQTT".into());
    }
    if port == 0 {
        return Err("Informe uma porta entre 1 e 65535".into());
    }
    // Keep the supplied hostname for DNS, SNI, certificate checks and WS Host.
    if host.is_empty()
        || host
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '/' | '\\' | '?' | '#' | '@'))
        || (host.contains(':') && host.parse::<IpAddr>().is_err())
    {
        return Err(
            "Informe somente o hostname ou IP do broker, sem esquema, porta ou caminho".into(),
        );
    }
    rustls::pki_types::ServerName::try_from(host.to_owned())
        .map_err(|_| "Hostname/IP do broker inválido".to_string())?;
    let (ca, cert, key) = (nonempty(ca), nonempty(cert), nonempty(key));
    if cert.is_some() != key.is_some() {
        return Err("TLS: informe certificado e chave do cliente em conjunto".into());
    }
    if !mode.secure() && (ca.is_some() || cert.is_some() || key.is_some()) {
        return Err("Há arquivos TLS configurados; selecione TLS ou WSS, ou remova explicitamente esses arquivos".into());
    }
    let transport = match mode {
        MqttTransport::Tcp => Transport::Tcp,
        MqttTransport::Ws => Transport::Ws,
        MqttTransport::Tls => Transport::Tls(TlsConfiguration::Rustls(Arc::new(tls_config(
            ca, cert, key,
        )?))),
        MqttTransport::Wss => Transport::Wss(TlsConfiguration::Rustls(Arc::new(tls_config(
            ca, cert, key,
        )?))),
    };
    let endpoint = if matches!(mode, MqttTransport::Ws | MqttTransport::Wss) {
        let path = websocket_path.unwrap_or("/mqtt");
        if !path.starts_with('/')
            || path
                .chars()
                .any(|c| c.is_whitespace() || matches!(c, '#' | '\\'))
        {
            return Err("Caminho WebSocket inválido; use /mqtt ou outro caminho iniciado por /, sem espaços ou fragmento".into());
        }
        let authority = if host.contains(':') {
            format!("[{host}]")
        } else {
            host.to_owned()
        };
        format!(
            "{}://{authority}:{port}{path}",
            if mode.secure() { "wss" } else { "ws" }
        )
    } else {
        host.to_owned()
    };
    let mut options = MqttOptions::new(client_id, endpoint, port);
    options.set_transport(transport);
    Ok(options)
}

#[cfg(test)]
mod tests;
