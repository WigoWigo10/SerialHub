# PAIC — Etapa 06: preparação da integração Serial no Windows

Data: 13/10/2026 (America/Manaus). Branch `feature/shared-core-cli`, HEAD `36b53ae019a1bf3e2809725df624c05a4ce97218`. Trabalho local, sem commit, push ou merge.

**Não há par de portas virtuais confirmado neste Windows. Os testes nativos de comunicação não foram executados nem aprovados.** Foi preparado um procedimento reutilizável e testado seu funcionamento com substitutos determinísticos, sem abrir portas.

## Referências e preservação

Lidos os registros das etapas [4](etapa-04-conexao-serial.md) e [5](etapa-05-cli-monitor-serial.md), os comandos de monitoramento, o tratamento de RX da GUI e o resultado externo da reprodução limpa em `C:\Users\higor\Documents\VSCode\Pessoal\SerialHub-repro-d72fcbf-results\README.md`. Não foi encontrado AGENTS.md no repositório; a consulta anterior aos ancestrais também não encontrou instruções adicionais. Conferidos status, HEAD e diff das alterações preexistentes.

O checkout publicado `d72fcbf` compilou núcleo/CLI e aprovou 49 testes, mas falhou nos builds frontend/backend devido aos BOMs de `package.json` e `src-tauri/tauri.conf.json`; quatro testes backend ficaram bloqueados. Essa falha de reprodução continua aberta: nenhuma configuração foi corrigida nesta etapa. O diretório original tem configurações locais sem esses BOMs; um futuro teste GUI nesse diretório deverá registrar essa diferença, sem afirmar reprodução do commit publicado.

Preservados os quatro arquivos modificados anteriores (`package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`), PDF e três scripts Python locais. Esta entrega acrescenta somente o script, seus testes, este registro e evidências. Nenhum código de produção Serial, GUI ou CLI foi alterado.

## Inventário real — somente leitura

Executadas consultas `Get-CimInstance Win32_SerialPort`, `Win32_PnPEntity` (classe Ports e nomes de emuladores), `Win32_SystemDriver` (nomes de drivers virtuais) e leitura de `HKLM:\HARDWARE\DEVICEMAP\SERIALCOMM`. Também consultados os caminhos usuais `C:\Program Files\com0com` e `C:\Program Files (x86)\com0com`, sem instalação encontrada. As consultas e a geração de evidência retornaram zero.

| Fonte | Evidência |
| --- | --- |
| Win32_SerialPort | Somente COM3: Intel(R) Active Management Technology - SOL |
| PnP | COM3, serviço Serial, fabricante Intel, identidade PCI VEN_8086/DEV_7E73, status OK |
| Registro SERIALCOMM | `\Device\Serial0 → COM3` |
| Drivers virtuais pesquisados | Lista vazia |
| Par virtual A/B | Nenhum confirmado |

Evidências: [inventory.json](evidencias/etapa-06-inventario/inventory.json) e [result.json](evidencias/etapa-06-inventario/result.json). `passed: true` no modo inventory significa exclusivamente que a consulta funcionou; `native_monitor_test: false` distingue isso de comunicação Serial.

O rótulo `Virtual` da enumeração SerialHub não prova a origem virtual de um dispositivo. **COM3 foi excluída explicitamente**, não foi aberta e não recebeu bytes. O inventário não prova ausência de todo produto possível instalado em qualquer caminho; prova que nenhum par utilizável foi confirmado pelas fontes consultadas.

## Ferramenta necessária para criar o par

É necessário um emulador de cabo null-modem virtual instalado/configurado manualmente, por exemplo [com0com, projeto oficial](https://com0com.sourceforge.net/). Ele conecta a saída de uma ponta à entrada da outra. O [ReadMe oficial](https://com0com.sourceforge.net/com0com/ReadMe.txt) descreve os identificadores CNCA/CNCB e a consulta `setupc list`.

Selecionar uma distribuição de driver compatível com este Windows e sua política de assinatura. Nenhum driver foi instalado, nem assinatura de drivers/Secure Boot modificados. A instalação e a criação do par são uma ação posterior do responsável pela máquina. O script desta entrega suporta especificamente com0com; outro produto exige adaptar a confirmação da configuração/PnP, sem remover a verificação de origem virtual.

Depois de instalar, configurar um par dedicado com nomes COM disponíveis — os exemplos COM10/COM11 abaixo são **placeholders, não portas presentes ou autorizadas automaticamente**. Conferir no configurador com0com:

```text
CNCA0 PortName=COM10
CNCB0 PortName=COM11
```

Ou `PortName=COM#,RealPortName=COM10`/`COM11`, com o mesmo índice A/B. Capturar `setupc list` e o inventário PnP real. Desabilitar eco/rotas adicionais no par; fechar outros consumidores. O script recusa endpoints iguais, COM3, pares de índices distintos, mapeamentos ambíguos, dispositivos ausentes/inativos e identidades PnP sem com0com.

## Script reutilizável e requisitos

[scripts/serial_integration.py](../../scripts/serial_integration.py) usa Python 3, subprocessos e arquivos binários; o emissor requer `pyserial==3.5`. A [API oficial pySerial](https://pyserial.readthedocs.io/en/latest/pyserial_api.html) documenta abertura, escrita de bytes e parâmetros. O inventário, a confirmação do par, a reabertura e os testes do script não requerem pySerial. Nenhuma dependência Python foi instalada nesta tarefa.

Preparação futura, na raiz do repositório:

```powershell
cargo build --locked --manifest-path crates/serialhub-cli/Cargo.toml
python -m venv "$env:TEMP\serialhub-etapa06-venv"
& "$env:TEMP\serialhub-etapa06-venv\Scripts\python.exe" -m pip install pyserial==3.5
$serialTestPython = "$env:TEMP\serialhub-etapa06-venv\Scripts\python.exe"
$serialTestSetupc = 'C:\Program Files\com0com\setupc.exe'
$serialTestExe = (Resolve-Path '.\crates\serialhub-cli\target\debug\serialhub.exe').Path
```

Alternativamente usar a CLI já compilada no worktree publicado, registrando seu caminho/commit. A CLI não depende do frontend nem da configuração Tauri que falharam no checkout limpo.

Cada execução exige um diretório de saída novo para não sobrescrever evidências. Nos comandos abaixo substituir portas e caminho setupc pelos valores confirmados:

```powershell
& $serialTestPython scripts/serial_integration.py confirm --setupc $serialTestSetupc --monitor-port COM10 --sender-port COM11 --output "$env:TEMP\serialhub-etapa06-confirm"
& $serialTestPython scripts/serial_integration.py duration --setupc $serialTestSetupc --monitor-port COM10 --sender-port COM11 --exe $serialTestExe --duration 5 --output "$env:TEMP\serialhub-etapa06-duration"
```

`confirm` executa somente `setupc list` e inventário. `duration` confirma novamente o par, abre o emissor em COM11, inicia `serialhub serial monitor --port COM10 --baud 115200 --duration 5` e espera a mensagem de recepção em stderr antes de enviar. Depois compara stdout integralmente, exige exit 0 e estados de início/término em stderr. Inicia outro monitor em COM10, por 0,25 s, sem enviar bytes: exige exit 0 e stdout vazio, verificando uma abertura nativa via núcleo após liberar a sessão anterior.

Configuração: 115200, 8N1, sem controle de fluxo. CLI mantém timeout de leitura de 50 ms e comportamento DTR/RTS do driver, sem calls explícitas de controle. pySerial aplica seus defaults de DTR/RTS na ponta emissora; não se usa hardware/software handshake. A GUI tenta baixar DTR/RTS após abrir, conforme etapa 4. O teste não valida eletricamente essas linhas nem mede desempenho.

Sequência de 33 bytes:

```text
ASCII: SERIALHUB ASCII\r\nline2\n + NUL + FF 80 C3 28 + END\r\n
HEX:   53 45 52 49 41 4C 48 55 42 20 41 53 43 49 49 0D 0A 6C 69 6E 65 32 0A 00 FF 80 C3 28 45 4E 44 0D 0A
```

O arquivo `expected.bin` contém a sequência original. `duration.stdout.bin` contém exclusivamente bytes recebidos; `duration.stderr.bin` mantém estados/erros. A captura usa `subprocess.Popen(stdout=arquivo_wb, stderr=arquivo_wb)` e leitura com `read_bytes`, sem `text=True`, decode ou pipeline PowerShell. A igualdade é de bytes completos, não de renderização textual. Evidências adicionais: comandos, códigos, tempo monotônico, HEX/SHA-256, inventário, saída setupc e resultado JSON. Dados adicionais ou perda/alteração de um byte causam falha. A escrita do emissor trata progresso parcial.

Se o monitor falhar ou não ficar pronto, não se transmite a sequência. Uma falha/timeout do procedimento pode exigir kill do processo filho para limpeza; **kill nunca é tratado como Ctrl+C aprovado**. Não há prazo rígido para driver/flush bloqueado. Não usar o procedimento com equipamentos físicos.

## Ctrl+C nativo — procedimento manual pendente

Após confirmar o par, encerrar GUI/outros consumidores e rodar novamente o modo confirm. Abrir um **Prompt de Comando Windows interativo** (`cmd.exe`) na raiz do repositório. Os comandos seguintes são para CMD, não redirecionamento de texto PowerShell:

```bat
mkdir "%TEMP%\serialhub-etapa06-ctrlc"
.\crates\serialhub-cli\target\debug\serialhub.exe serial monitor --port COM10 --baud 115200 > "%TEMP%\serialhub-etapa06-ctrlc\stdout.bin" 2> "%TEMP%\serialhub-etapa06-ctrlc\stderr.bin"
```

Sem duração, aguardar a mensagem de recepção em stderr (consultar o arquivo em outro terminal), então **pressionar fisicamente Ctrl+C nesse terminal**. O CMD redireciona handles para arquivos, preservando bytes; isso também evita falhas de console Rust ao exibir dados não UTF-8. Nenhum dado precisa ser enviado neste ensaio de sinal.

Assim que retornar ao prompt, antes de executar outro comando:

```bat
echo %ERRORLEVEL% > "%TEMP%\serialhub-etapa06-ctrlc\exit-code.txt"
type "%TEMP%\serialhub-etapa06-ctrlc\exit-code.txt"
```

Critério: código **130**, stdout vazio neste ensaio sem emissor, mensagem `Ctrl+C; conexão liberada.` em stderr. Capturar screenshot do terminal e guardar os três arquivos. Em seguida, no PowerShell, usando as variáveis anteriores:

```powershell
& $serialTestPython scripts/serial_integration.py reopen --setupc $serialTestSetupc --monitor-port COM10 --sender-port COM11 --exe $serialTestExe --output "$env:TEMP\serialhub-etapa06-reopen-after-ctrlc"
```

Exigir confirmação do mesmo par, abertura bem-sucedida, exit 0 e stdout vazio. Se for usado binário do worktree, ajustar seu caminho também no CMD. Registrar Ctrl+C e reabertura separadamente. Nenhum sinal foi enviado programaticamente nesta entrega; testes de flag simulada na etapa 5 não validam evento nativo do console Windows.

## GUI — procedimento manual pendente no mesmo par

1. Encerrar os monitores CLI. No diretório original, iniciar `npm run tauri dev`, registrando HEAD e configurações locais. No checkout publicado, resolver antes os erros de BOM descritos na reprodução e revalidar os builds; esta entrega não os corrige.
2. Atualizar lista, selecionar a ponta receptora confirmada (exemplo COM10), 115200/8N1/sem fluxo e conectar. Guardar screenshot do estado conectado com nome correto. Não selecionar COM3 nem enviar pela barra de comandos.
3. Selecionar modo HEX, desabilitar timestamps para facilitar a comparação e limpar o terminal. No outro terminal, executar o emissor confirmado:

```powershell
& $serialTestPython scripts/serial_integration.py send --setupc $serialTestSetupc --monitor-port COM10 --sender-port COM11 --output "$env:TEMP\serialhub-etapa06-gui-rx1"
```

4. Conferir no HEX todos os 33 bytes acima na ordem, incluindo `00 FF 80 C3 28`. Pacotes podem ser fragmentados; comparar a sequência concatenada. Guardar screenshot/seleção do terminal e result.json do emissor. O sucesso de send comprova somente envio; não prova recepção GUI. Em ASCII, quebras de linha devem renderizar, mas NUL/não UTF-8 não são prova visual de igualdade; HEX é necessário para esse contrato.
5. Desconectar na GUI, registrar estado desconectado e eventuais erros. Reconectar a mesma porta e limpar o terminal; executar send novamente com outro diretório de saída (`gui-rx2`). Comparar exatamente uma sequência completa, sem duplicação de leitor antigo. Repetir desconexão/reconexão durante ociosidade/timeout; salvar evidências de cada fase.
6. Desconectar e sair da GUI; executar modo reopen na CLI com nova pasta de evidência. A abertura bem-sucedida verifica que a GUI liberou os handles. Restaurar configurações de exibição alteradas para o teste. RX/TX em arquivo e testes de perda de dispositivo ficam fora desse ensaio.

A inspeção anterior da GUI comprovou somente inicialização e enumeração. Conexão, RX, desconexão e reconexão permanecem não validados nativamente.

## Verificações executadas nesta etapa

```powershell
python scripts/serial_integration.py inventory --output docs/paic/evidencias/etapa-06-inventario
python scripts/serial_integration.py --help
$env:PYTHONDONTWRITEBYTECODE = '1'
python -m unittest discover -s tests -p test_serial_integration.py -v
git diff --check
```

Todos retornaram zero. **13 testes do procedimento passaram**, sem hardware: confirmação A/B, RealPortName, rejeição de identidade física/ausente/inativa/ambígua, exclusão COM3 antes de inventariar/abrir, sequência binária, escrita parcial/sem progresso, comparação exata, códigos/streams, captura binária, prontidão antes de enviar, não envio quando monitor falha e abertura simulada vazia. Evidência em [testes-script.txt](evidencias/etapa-06-inventario/testes-script.txt). Esses 13 testes são do script de integração, não aumentam a evidência nativa do SerialHub. Não foram repetidas compilações/testes de produção, pois não houve alteração em seus arquivos. Os oito arquivos locais preexistentes conservaram os hashes da verificação anterior. Os arquivos novos também foram conferidos com `git diff --no-index --check -- /dev/null <arquivo>`.

| Verificação nativa | Resultado atual |
| --- | --- |
| Confirmar par virtual real | Bloqueada: nenhum par confirmado |
| Comparar RX CLI binário e término --duration | Pendente |
| Reabrir após --duration | Pendente |
| Ctrl+C físico em terminal Windows, exit 130 | Pendente |
| Reabrir após Ctrl+C | Pendente |
| GUI conectar, receber, desconectar e reconectar | Pendente |

Próximo passo: instalar/configurar manualmente um par virtual compatível, registrar as duas pontas e executar os procedimentos acima. Não há aprovação de testes nativos, instalação automática, commit, push ou merge nesta etapa.
