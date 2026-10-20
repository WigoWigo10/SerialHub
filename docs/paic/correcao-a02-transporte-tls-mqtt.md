# Correção A02 — transporte MQTT e TLS explícitos

Data: 20/10/2026, America/Manaus. Branch `feature/shared-core-cli`.

## Referência e preservação

Conferidos status, branch e diff; lidos a auditoria, perfis, frontend e backend atuais. Não foi encontrado AGENTS.md no repositório nem nos ancestrais até C:\.

Conforme autorização inicial, **somente A01** foi commitado em `d3c95ec` (`fix(mqtt): safely handle literal topic and JSON field names`): `TopicTree.tsx`, as consultas próprias do consumidor em `MqttPage.tsx`, seus testes e documentação. Sem push. Etapa 8, PDF, scripts e demais arquivos preexistentes ficaram fora desse commit. **A02 permanece sem commit, push ou merge.**

Após esse commit, registrados hashes de 32 arquivos locais preexistentes em `%TEMP%\serialhub-a02-baseline.json`: 30 permaneceram byte a byte idênticos. Os outros dois, `lib.rs` e `translations.ts`, receberam adições A02; removendo somente essas adições, seus hashes também coincidem com a referência. Isso preserva integralmente as alterações anteriores da etapa 8 nesses arquivos. Os testes A01 permanecem aprovados; sua árvore não foi modificada nesta etapa.

## Causa

O backend anterior só montava TLS quando recebia simultaneamente CA, certificado e chave. CA isolada era descartada como configuração incompleta; podia resultar em TCP/WS simples. A porta 8883 também acionava uma tentativa implícita de TLS com raiz vazia. O frontend mostrava segurança conforme caminhos de arquivos e um único boolean de WebSockets, sem representar os quatro modos. Além disso, a resolução prévia substituía o hostname por IPv4 antes de criar `MqttOptions`, comprometendo a identidade esperada pelo TLS.

## Contrato implementado

| Modo explícito | Transporte rumqttc | Autenticação do servidor | Certificado do cliente |
|---|---|---|---|
| `tcp` | `Transport::Tcp` | Sem TLS | Não permitido configurar arquivos TLS |
| `tls` | `Transport::Tls(Rustls)` | Cadeia e hostname/IP verificados | Opcional; certificado e chave juntos |
| `ws` | `Transport::Ws` | Sem TLS | Não permitido configurar arquivos TLS |
| `wss` | `Transport::Wss(Rustls)` | Cadeia e hostname/IP verificados | Opcional; certificado e chave juntos |

A **porta não seleciona o transporte**. TLS em 1883 continua TLS; TCP em 8883 continua TCP quando explicitamente escolhido sem arquivos TLS. A interface identifica o modo selecionado, avisa quando não há criptografia e explica que a validação TLS ocorrerá ao conectar. O cadeado depende do modo seguro selecionado, não da presença de arquivos. A troca do modo não altera automaticamente a porta.

O novo argumento IPC obrigatório `transport` aceita somente `tcp`, `tls`, `ws`, `wss`. O antigo `useWebsockets` não seleciona transporte no comando. Chamadores antigos sem modo recebem erro de argumento; não há default silencioso. `websocketPath` é opcional no backend, com default `/mqtt`; a UI permite configurar esse caminho. Para WS/WSS, o backend constrói a URL completa com esquema, hostname original, porta e caminho. IPv6 recebe colchetes na autoridade da URL.

O campo broker recebe somente hostname ou IP, sem esquema, porta ou caminho. Removida a conversão prévia para IPv4; rumqttc e o sistema resolvem o endereço, preservando o nome para SNI, validação do certificado e Host WebSocket. Não há opção para ignorar validação de certificado/hostname nem customização insegura do verificador Rustls.

### Confiança e identidade

- **CA personalizada informada:** certificados PEM desse arquivo são as únicas raízes usadas para essa conexão. Não há adição silenciosa de raízes do sistema nem fallback se o arquivo falhar.
- **Sem CA personalizada:** carregadas raízes de confiança da plataforma por `rustls-native-certs`. Se o carregamento falhar, produzir raiz inválida ou nenhuma raiz estiver disponível, a configuração falha explicitamente e solicita CA. Não é instalado certificado nem modificado o trust store.
- **CA isolada:** permitida em TLS/WSS, com autenticação do servidor e sem mTLS.
- **Identidade do cliente:** opcional, independente da CA personalizada. Certificado e chave devem ser fornecidos juntos; pode-se usar mTLS com raízes do sistema.
- Arquivos são lidos e validados **antes de criar/substituir o AsyncClient**: existência/leitura, certificados PEM e DER, chave privada suportada e correspondência entre chave e certificado folha. A correspondência é comprovada assinando um desafio local e verificando a assinatura com a chave pública do certificado. Nenhum desafio/assinatura é enviado ao broker.
- Chaves privadas devem estar em PEM não criptografado, em formato suportado pelo Rustls (PKCS#8/PKCS#1/SEC1 conforme algoritmo). Formato ausente, inválido ou criptografado recebe erro claro. A aceitação da cadeia/validade do certificado do cliente é responsabilidade adicional do servidor no handshake.
- TCP/WS com qualquer arquivo TLS configurado falha: é necessário selecionar TLS/WSS ou remover explicitamente esses arquivos. Nunca são simplesmente ignorados.

Falhas de configuração retornam erro; falhas de handshake continuam pelo fluxo de erro MQTT existente, sem reconexão automática por transporte simples. Cancelamento e isolamento de sessões MQTT (A03) não foram redesenhados.

## Perfis e migração conservadora

Perfis passam a salvar `transport`, `transportNeedsReview` e, quando aplicável, `websocketPath`. A senha continua somente em memória: não está no modelo persistido, é removida em toda fronteira de persistência e é limpa no campo ao carregar perfil. Os testes anteriores de credenciais foram mantidos; a fixture deles agora representa um perfil com transporte já explícito, e os novos testes cobrem perfis realmente legados.

A migração preserva todos os campos anteriores, incluindo extras desconhecidos, tópicos, LWT, caminhos, porta, IDs, nome e `useWebsockets` histórico. Também preserva o envelope/versionamento do JSON armazenado. O boolean antigo é apenas uma pista durante migração; depois de existir modo explícito, ele não o substitui.

**Todo perfil sem modo reconhecido exige revisão explícita antes de conectar ou salvar**, inclusive um perfil aparentemente simples. A migração grava esse estado imediatamente e é idempotente. Não modifica configurações reais do usuário fora do storage utilizado pela aplicação.

| Perfil antigo | Sugestão inicial | Confirmação obrigatória |
|---|---|---|
| TCP sem indício de TLS | TCP | Sim |
| WebSocket sem indício de TLS | WS | Sim |
| Qualquer caminho CA/cert/key | TLS ou WSS conforme família WS | Sim, inclusive material incompleto |
| Porta 8883 ou 443 | TLS/WSS conservadoramente | Sim; número da porta é apenas pista na migração |
| URL `wss://`, `mqtts://` ou `tls://` | Modo seguro | Sim; corrigir broker para hostname e preencher caminho separado |
| Modo desconhecido/antigo, incluindo maiúsculas | Sugestão conservadora baseada nas pistas | Sim |
| Modo explícito reconhecido | Mantém o modo, independentemente de porta e boolean antigo | Mantém marca de revisão, se existente; configurações inconsistentes continuam rejeitadas |

Ambiguidade não autoriza uma conexão. Na UI, o aviso solicita conferir modo, porta, hostname e arquivos e clicar **Confirmar transporte**. Essa confirmação também valida combinações de campos. Se o perfil foi carregado sem editar seus demais dados, a confirmação atualiza sua marca/modo no storage. Ao editar configurações, a UI abandona a associação com o perfil anterior: confirme a configuração atual e salve um novo perfil pelo fluxo de salvamento existente para persistir a decisão. Arquivos legados ausentes/inválidos continuam bloqueando a conexão, mesmo depois de uma revisão de modo.

## Arquivos e dependências

- Novo `src-tauri/src/commands/mqtt_transport.rs`: enum de modos, validação de configuração, raízes e identidade, construção dos MqttOptions.
- `mqtt_cmd.rs`: delega a configuração antes do AsyncClient; removidos seleção por porta, fallback e resolução IPv4 prévia.
- `lib.rs`: somente a declaração do novo módulo somada às alterações preexistentes.
- Novo `src/lib/mqttTransport.ts`: modos, validação frontend e migração determinística.
- `mqttStore.ts`: fronteiras de migração/persistência, preservando remoção de senha.
- `MqttPage.tsx`: seletor de quatro modos, caminho WS, indicação de segurança, revisão de legado e novos argumentos IPC. Consultas próprias corrigidas no A01 foram preservadas.
- `translations.ts`: mensagens adicionadas em português, inglês e espanhol; textos novos não substituem as traduções Serial da etapa 8.
- Novos testes Node/Rust e seis fixtures PEM de teste, com README. As chaves dessas fixtures são públicas e exclusivas de testes, não credenciais de implantação. Certificados P-256/SHA-256 válidos de 2020 a 2040; SAN do servidor `localhost`. Não foi persistida a chave privada da CA geradora.

Três dependências **já transitivas e presentes no lockfile** passaram a diretas, sem atualizar versões/checksums: `rustls-pemfile 2.2.0` (validar PEM antes de conectar), `rustls-native-certs 0.7.3` (raízes do sistema com erro recuperável, sem usar default que pode entrar em panic) e `rustls-webpki 0.102.8` (validar DER e correspondência certificado/chave). Rustls é usado pela reexportação já disponível em rumqttc. Cargo.lock alterou somente as três entradas na lista de dependências do pacote SerialHub. Não foram alterados npm manifest/lockfile nem feitas atualizações gerais de dependências.

## Validação

| Comando | Resultado final |
|---|---|
| `node --test tests/*.test.mjs` | **84 aprovados**, zero falhas; inclui 19 testes A02, 23 A01, credenciais e regressões anteriores |
| `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml` | **28 aprovados**, zero falhas; inclui 9 testes novos A02 e regressões Serial/etapa 8 |
| `npm run build` | **Aprovado**, TypeScript/Vite; avisos preexistentes de Browserslist desatualizado e bundle acima de 500 kB |
| `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` | **Aprovado** |
| `rustfmt --check --edition 2021 --config skip_children=true src-tauri/src/commands/mqtt_transport.rs src-tauri/src/commands/mqtt_transport/tests.rs` | **Aprovado** |
| `git diff --check` | **Aprovado**; avisos informativos LF/CRLF |
| Comparação dos hashes preexistentes | 30/32 idênticos; nos outros dois, removendo só as adições A02, os hashes também coincidem |

Os testes cobrem quatro modos em 1883/8883/443/8000/12345, preservação do hostname, URL/caminho WS e IPv6, CA isolada, mTLS completo, pares incompletos, arquivos ausentes/diretório/sem certificado/chave inválida/DER inválido, chave de outro certificado, ausência de CA personalizada e modos/endereços inválidos. Resultados de erro não produzem MqttOptions de transporte simples.

### Handshakes reais locais

Havia infraestrutura suficiente para um servidor Rustls controlado em `127.0.0.1`, porta efêmera. Os testes usam o ClientConfig realmente construído pelo novo módulo, timeouts de socket de três segundos, fixtures locais e nenhum broker externo:

| Cenário | Resultado |
|---|---|
| CA de teste confiável + hostname localhost | Handshake e troca de bytes aceitos |
| CA não relacionada | Handshake rejeitado |
| Hostname `wrong.example` para certificado localhost | Handshake rejeitado |
| Servidor exige mTLS + identidade cliente correta | Aceito |
| Servidor exige mTLS + cliente sem certificado | Rejeitado |

São testes TLS reais em sockets de loopback, não apenas cancelamentos/transportes simulados. A configuração usada por WSS também preserva o verificador padrão e foi exercitada no caso de hostname incompatível. Isso não equivale a executar upgrade WebSocket ou MQTT CONNECT/CONNACK.

## Limitações e pendências

Permanecem pendentes inspeção visual da GUI atual, diálogos de certificados e conexão completa MQTT/WS/WSS com broker controlado, incluindo seus caminhos e respostas de upgrade. Não se validou uma cadeia pública usando raízes Windows contra um servidor externo. O teste de raízes da plataforma permite erro explícito em ambientes sem trust store utilizável; não aprova fallback.

A infraestrutura local de handshake não altera trust store, não instala drivers e não abre portas Serial. Fixtures expiram em 2040 e deverão ser renovadas para manter esses testes válidos. Não foram modificados nem testados novamente núcleo/CLI Serial, pois esta correção não os altera. Cancelamento/sessões A03 e atualização geral de dependências continuam fora do escopo.
