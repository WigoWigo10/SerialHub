# PAIC — Etapa 01: referência e credenciais MQTT

Data: 13/10/2026 (America/Manaus). Trabalho local no SerialHub, com commit autorizado após a conclusão da etapa, sem push ou publicação.

## Referência reproduzível

- Diretório: `C:\Users\higor\Documents\VSCode\Pessoal\SerialHub`.
- Branch: `main`.
- Commit: `a04a1115e70811924c50c7d37268b32e83c4b49a` — `chore: bump version to 1.2.1`.
- Versão nos manifests e configuração Tauri: `1.2.1`.
- Ambiente: Windows `10.0.26200.0`, PowerShell; Node `v24.11.1`, npm `11.6.4`, cargo `1.93.0`, rustc `1.93.0`; toolchain `stable-x86_64-pc-windows-msvc`.
- Dependências instaladas relevantes: React `18.3.1`, Zustand `4.5.7`, TypeScript `5.9.3`, Vite `5.4.21`, Tauri API `2.11.1`, CLI `2.11.4`.

A validação inicial usou uma árvore com alterações locais anteriores, não apenas o commit. O `git status --short` inicial apresentou:

```text
 M package-lock.json
 M package.json
 M src-tauri/Cargo.toml
 M src-tauri/tauri.conf.json
?? PAIC2026_Proposta-HigorCavalcante.pdf
?? leitor.py
?? leitor_diff.py
?? simulador_iot.py
```

Esses oito arquivos foram preservados: os hashes SHA-256 finais coincidiram com os iniciais. Não havia alterações staged. As diferenças dos quatro arquivos rastreados foram capturadas **antes da correção** em [etapa-01-referencia-local.patch](etapa-01-referencia-local.patch). Esse patch documenta trabalho anterior do usuário e não faz parte da correção de credenciais.

| Arquivo da referência | SHA-256 inicial e final |
| --- | --- |
| `package.json` | `681E2BCE1E4CA34F43D60B24D3B9E9E00CD4441128F3BF0C1E8A6AD6625D2040` |
| `package-lock.json` | `ACCAA970F7CB69E141301EDA87CAA137FF6E976DA4D272B5E85A4488ECB29FD7` |
| `src-tauri/Cargo.toml` | `5A32DBAFEE9677737257D202D712BB1CBD74AF53A2719D54F69AD5B22657F24E` |
| `src-tauri/tauri.conf.json` | `0B8F419F5B5A084A0D1D08017651BCE1CA113C1E4AFA2018FA4C8F58D7B9DBB7` |
| `PAIC2026_Proposta-HigorCavalcante.pdf` | `96810140F07A52FACEC3F789B54488E04ECE2EEEF11DF06BB2A646FCA8C6F694` |
| `leitor.py` | `A8675FEEE1F88BD2342CF20724A4FD61EC085FF9AC482C00583A9C8AE4A69B80` |
| `leitor_diff.py` | `7E3392DCF325FD0AB0C997ECC78ED5C62E8E925771D00E27CF03FE92BF2D8DA8` |
| `simulador_iot.py` | `59BD23495AA0F4418F69E07EB7EC5A74B9384A470DFA4FC2F18E509BDA8347F2` |

`src-tauri/Cargo.lock` também foi preservado (SHA-256 `CDDAE7018257FF72EDE22717E4E13F7311773017E12365200BE8EDFD76FFF0BB`).

Para reproduzir a referência inicial, use **outro checkout**, no commit acima, aplique o patch de referência e instale a partir dos lockfiles:

```powershell
git checkout --detach a04a1115e70811924c50c7d37268b32e83c4b49a
git apply <caminho-do-patch>/etapa-01-referencia-local.patch
npm ci
npm run build
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

Essa receita não foi executada em um checkout limpo nesta etapa. As verificações usaram as dependências já instaladas; não foi necessário instalar ou atualizar pacotes. Os arquivos não rastreados não são usados pelos dois comandos de compilação e não foram copiados para o patch. Para reproduzir a correção, use o commit que adiciona este documento (`git log --diff-filter=A -- docs/paic/etapa-01-credenciais-mqtt.md`) e aplique o patch de referência para recuperar as configurações locais usadas na validação. O commit da etapa inclui a correção, os testes e a documentação; as alterações preexistentes permanecem fora dele.

## Instruções e trechos examinados

Não foi encontrado `AGENTS.md` no repositório (incluindo arquivos ocultos, excluindo dependências, target e `.git`) nem nos diretórios ancestrais até `C:\`.

- `README.md`: pré-requisitos, desenvolvimento (`npm run tauri dev`) e distribuição (`npm run tauri build`).
- `docs/architecture/feasibility_report.md`: arquivo existente vazio.
- `package.json`: `build` executa `tsc && vite build`; não havia script ou framework de testes.
- `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `tsconfig.json` e `.gitignore`: dependências, build Tauri, checagem TypeScript e saídas ignoradas.
- `src/components/pages/MqttPage.tsx`: estado React `password` (linha original 131), `handleConfirmSave` (288–299), `handleLoadProfile` (342–389), `connectionParams` e log do objeto (550–566), envio via `invoke("connect_mqtt", connectionParams)` e campo editável de senha (815–816).
- `src/stores/mqttStore.ts`: interface `MqttProfile`, ações add/update/remove e persistência integral em `serialhub-mqtt-profiles` via `createJSONStorage(() => localStorage)`.
- `src-tauri/src/commands/mqtt_cmd.rs`: parâmetros de autenticação em `connect_mqtt`, `set_credentials`, logs de conexão/eventloop e ausência de persistência de senha no comando.
- `src/i18n/translations.ts`: texto do modal que afirmava salvar credenciais em PT/EN/ES.
- Middleware Zustand instalado: hidratação e escrita. A versão instalada não reescreve automaticamente um estado da mesma versão ao hidratar; por isso a limpeza grava imediatamente o JSON sanitizado na leitura.

## Alterações implementadas

1. Removido o log de `connectionParams` no frontend. Esse objeto ainda transmite a senha ao backend, como necessário para autenticar, mas não é enviado ao console.
2. Removido o nome de usuário do log de autenticação Rust; a mensagem agora informa somente que autenticação por usuário/senha está habilitada.
3. Removido `password` da interface e do salvamento de perfis. A senha digitada permanece no estado React e nas estruturas em memória necessárias à conexão MQTT.
4. Ao carregar qualquer perfil, a senha é zerada e sua exibição volta ao modo oculto. O campo existente permite informar a senha novamente antes de conectar.
5. Ações de criação/atualização descartam `password` de objetos legados. `partialize` também remove esse campo de cada perfil antes de qualquer persistência.
6. Na leitura de JSON antigo, remove-se somente a propriedade `password` dos perfis e grava-se o resultado imediatamente na mesma chave. Preservam-se envelope, versão, ordem, IDs, demais configurações e campos adicionais. Funciona tanto para versão `0` quanto para JSON sem versão; não depende de editar ou salvar o perfil.
7. Texto do modal atualizado nos três idiomas para explicar que a senha fica em memória e precisa ser informada novamente ao carregar o perfil.
8. Acrescentados testes focados com `node:test` e o TypeScript já instalado, sem modificar manifests ou lockfiles.

## Verificações executadas

| Verificação no Windows | Antes | Depois |
| --- | --- | --- |
| `npm run build` | Sucesso, exit 0 | Sucesso, exit 0 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Sucesso, exit 0 | Sucesso, exit 0 |
| `npm ls --depth=0` | Sucesso; nenhuma dependência ausente detectada | Manifests/dependências preservados |
| `node --test tests/mqtt-credentials.test.mjs` | Não existia | 7 testes passaram, 0 falhas |
| `git diff --check` | — | Sucesso após remover whitespace da linha editada |
| SHA-256 dos oito arquivos preexistentes | Registrados | Iguais |

Nenhuma falha de compilação anterior à correção foi encontrada. Avisos já presentes no frontend continuaram: base Browserslist/caniuse-lite com nove meses e chunk JavaScript acima de 500 kB. Não foram corrigidos porque estão fora do escopo. `cargo check` verifica compilação, mas não gera nem testa instalador, WebView2 ou aplicação em execução.

Os testes usam a senha **fictícia** `FAKE-MQTT-password-731!`, um perfil com usuário, broker, porta, client ID, tópicos, três caminhos TLS, LWT, WebSockets e um campo adicional. Exercitam o store Zustand real com um substituto de `localStorage` em memória:

- Limpeza imediata de JSON antigo com versão `0` e sem versão; comparação estrutural confirma que somente a senha foi removida, inclusive preservando campos extras no envelope e estado.
- Segunda hidratação não altera novamente o JSON; perfil já limpo não causa escrita desnecessária.
- Criação, atualização e remoção: configurações preservadas, senha ausente do estado das ações e de todas as escritas JSON. Console do store capturado sem a senha fictícia.
- `setState` direto com um perfil contendo senha: filtro impede sua persistência.
- JSON inválido não é sobrescrito; a hidratação permanece incompleta, sem limpeza destrutiva.
- Inspeção estática da AST da página: chamadas de console não recebem `password`, `username` ou `connectionParams`; campo de senha, limpeza ao carregar e envio IPC continuam presentes.

**Limite da evidência:** a checagem da página é estática. Não foi executado o clique em conectar nem capturado o console de uma sessão real Tauri/Rust. Não houve conexão a broker nem uso de credenciais reais. Os testes não alteram o armazenamento real do aplicativo.

## Verificações manuais pendentes

1. Abrir a aplicação com `npm run tauri dev`, usar broker de teste autenticado e credenciais fictícias, digitar senha, salvar perfil e conectar. Conferir DevTools e saída Rust: senha e usuário de autenticação não devem aparecer nos logs de credenciais; conexão deve autenticar normalmente.
2. Conferir `localStorage.getItem('serialhub-mqtt-profiles')` após salvar, atualizar e recarregar: sem propriedade `password` e sem valor da senha fictícia; demais configurações mantidas.
3. Em ambiente de teste, inserir JSON legado válido com `password` nessa chave e reiniciar a aplicação. Conferir remoção imediata do campo persistido sem salvar manualmente e preservação das configurações. Selecionar o perfil e informar a senha novamente.
4. Alternar entre dois perfis: senha deve ficar vazia e oculta em cada carregamento. Reiniciar a aplicação e confirmar que a senha não retorna.
5. Conferir visualmente o texto do modal nos três idiomas e testar os modos TCP/TLS/WebSockets usados pelo projeto.

## Limitações e próximos passos

- A limpeza ocorre quando esta versão lê a chave de perfis. Uma aplicação antiga ainda pode gravar senhas novamente. Logs, backups e cópias anteriores não são apagados por esta alteração.
- O escopo é a senha MQTT no campo próprio e os logs de credenciais identificados. Outros dados de perfil, incluindo usuário e caminhos TLS, continuam persistidos conforme solicitado. Inserir segredos em nomes, broker, tópicos ou payloads está fora dessa garantia.
- JSON inválido ou armazenamento indisponível/sem permissão de escrita impedem a hidratação/limpeza; não há rotina nova de recuperação desses casos.
- A senha não é apagada de forma criptográfica da memória. Pode permanecer no estado da página enquanto montada e nas estruturas do cliente MQTT enquanto necessárias à sessão/reconexão.
- Não foi validada uma instalação limpa, distribuição Tauri ou teste com broker real. Executar as verificações manuais antes de considerar a autenticação validada de ponta a ponta.
- Extração do núcleo Serial/MQTT e CLI compartilhada ficam para etapas futuras. Nenhuma dessas mudanças foi iniciada.
- O caminho de acompanhamento informado (`C:\Users\higor\OneDrive - uea.edu.br\UEA\PAIC\Acompanhamento`) não foi modificado; o registro solicitado foi criado dentro do repositório.
