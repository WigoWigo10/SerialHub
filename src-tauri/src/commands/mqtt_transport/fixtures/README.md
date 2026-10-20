These public test fixtures are for automated loopback tests only, never deployment.
Private keys here are intentionally non-secret test data. No OS trust store is modified.

Certificates were generated locally with Python cryptography: P-256, SHA-256,
valid from 2020-01-01 to 2040-01-01. `ca.pem` signs server/client certificates;
`other-ca.pem` is unrelated. The server SAN is `localhost`, and the leaf EKUs
are respectively serverAuth/clientAuth. The two leaf private keys differ.
