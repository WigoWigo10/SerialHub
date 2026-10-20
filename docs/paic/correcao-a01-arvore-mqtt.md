# Correção A01 — nomes recebidos na árvore MQTT

Data: 20/10/2026, America/Manaus. Branch `feature/shared-core-cli`, referência `fc4bf32b9012804cdc7d212354099c961fa2d506`. Trabalho local, sem commit, push ou merge.

## Referência e preservação

Lidos o achado A01 de [auditoria-estado-atual-2026-10-20.md](auditoria-estado-atual-2026-10-20.md), `TopicTree.tsx` e os consumidores em `MqttPage.tsx`. Conferidos status, branch e diff; não foi encontrado AGENTS.md no repositório nem nos ancestrais até C:\.

Antes das alterações, registrados SHA-256 de 32 arquivos modificados/não rastreados preexistentes em `%TEMP%\serialhub-a01-baseline.json`. Todos os 32 conservaram os hashes ao final, incluindo a etapa 8, auditoria e evidências anteriores, PDF e scripts locais. Nenhum manifest, lockfile, backend ou fluxo de conexão foi alterado. O índice permanece vazio.

## Reprodução e causa

Executadas as funções reais de `TopicTree.tsx`, transpilações TypeScript em contextos separados de `node:vm`, sem broker, interface gráfica ou portas Serial. A reprodução anterior à correção produziu:

| Entrada | Resultado anterior |
|---|---|
| Tópico `__proto__`, payload `data` | `Cannot convert undefined or null to object`; modificação de `Object.prototype` na VM |
| Tópico `constructor`, payload `data` | Mesma exceção |
| Tópico `normal`, JSON `{"__proto__":{"value":"data"}}` | Alteração de `Object.prototype` na VM, mesmo sem exceção propagada |

Os dicionários `children` eram objetos comuns e o teste `if (!children[name])` aceitava propriedades herdadas como nós existentes. Assim, `__proto__` acessava o protótipo, `constructor` acessava o construtor e a expansão escrevia metadados nesses objetos. O catch de JSON podia esconder a falha, sem desfazer a mutação.

Também havia colisão entre um subtópico e um campo JSON homônimo: ambos ocupavam `children[name]`. A expansão podia sobrescrever valor/metadados de um nó real, e a limpeza de campos virtuais podia depender da ordem das mensagens. O caminho completo perdia barras em níveis vazios iniciais porque o separador dependia de o texto acumulado ser não vazio.

Na integração com gráficos, as consultas `prevHistory[topic]` também aceitavam propriedades herdadas. A cópia para objeto comum seguida de atribuição dinâmica a `__proto__` podia alterar o protótipo do histórico. O percurso dos campos JSON não exigia propriedade própria.

## Solução localizada

### `src/components/mqtt/TopicTree.tsx`

- `childDictionary()` cria dicionários sem protótipo; `hasChild()` exige propriedade própria. Todos os nomes recebidos são índices nesses dicionários, nunca nomes de propriedades do nó de metadados.
- `children` contém somente segmentos reais MQTT; `jsonChildren` contém somente campos do payload. Ambos usam a mesma proteção. Não há blacklist: `__proto__`, `proto`, `constructor`, `prototype`, `toString` e `hasOwnProperty` são nomes literais aceitos.
- A atualização do payload substitui somente `jsonChildren`, preservando subtópicos reais. Arrays JSON continuam expandidos por índices, e objetos/valores seguem o formato visual anterior.
- `treeChildren()` combina os dois grupos para os consumidores visuais. Uma chave React baseada no grupo e no nome distingue irmãos reais e virtuais homônimos. O texto do nome recebido não é alterado.
- A composição de `fullName` considera o índice do segmento; `/a`, `a//b`, `a/`, `/` e `//` preservam suas barras.

### `src/components/pages/MqttPage.tsx`

Alterações limitadas ao consumidor dos nomes da árvore: consultas próprias no histórico e na propriedade `data` do gráfico; cópia de atualização sem protótipo; percurso JSON por propriedades próprias tanto na inicialização quanto na atualização. Os contratos de eventos, conexão, TLS, assinatura, publicação, retenção e formato HEX permanecem os existentes.

### `tests/mqtt-topic-tree.test.mjs`

23 testes novos executam as funções reais da árvore e os callbacks reais de atualização/inicialização do histórico, extraídos pelo AST TypeScript. Não há implementação alternativa do algoritmo nos testes. Cada contexto compara os descritores completos de `Object.prototype` e `Function.prototype` antes/depois; verifica também o protótipo do processo hospedeiro. Há uma verificação estática, identificada como tal, para as ligações do renderizador.

## Casos verificados

- Tópicos comuns, hierarquia, último payload/timestamp e expansão JSON habitual.
- Cada nome especial na raiz, em níveis aninhados, em objetos JSON aninhados e dentro de arrays.
- Níveis vazios MQTT válidos e nomes numéricos como `01` e `1`.
- Nomes iguais aos campos internos: `name`, `fullName`, `children`, `jsonChildren`, `value`, `originalValue`, `timestamp`, `isJson`, `isVirtual`.
- Campo JSON e subtópico homônimos coexistem nas duas ordens de chegada; as identidades React são distintas.
- Substituição de JSON elimina campos virtuais antigos sem apagar tópicos reais; mudança para texto também limpa somente campos virtuais.
- JSON primitivo, nulo, inválido, objeto vazio e array vazio mantêm o contrato de apresentação.
- Adição/atualização de gráficos com nomes especiais aceita somente entradas próprias e preserva o histórico correto. JSON com `__proto__` explícito pode fornecer dados; caminhos herdados ausentes não são percorridos.
- Os protótipos e seus descritores permanecem inalterados, e os dicionários da árvore têm protótipo nulo recursivamente.

## Comandos e resultados

| Comando | Resultado |
|---|---|
| Reprodução isolada anterior com `node --input-type=module` | A01 reproduzido nas funções reais, conforme tabela acima |
| `node --test tests/mqtt-topic-tree.test.mjs` — primeira execução | 22 aprovados, 1 falha no harness por ausência da variável de contexto `topic`; corrigido o teste |
| `node --test tests/*.test.mjs` — execução final | **65 aprovados, zero falhas**, incluindo os 23 novos e as regressões preexistentes |
| `npm run build` | **Aprovado**, TypeScript e Vite; avisos já existentes de Browserslist desatualizado e chunk acima de 500 kB |
| `git diff --check` | **Aprovado** |
| Comparação SHA-256 dos 32 arquivos preexistentes | **Todos idênticos** ao snapshot inicial |

Nenhuma dependência foi atualizada. As evidências da auditoria anterior foram mantidas como registro histórico da reprodução; não foram sobrescritas com resultados novos.

## Limitações

Os testes são determinísticos e não conectam a broker. A interação visual, seleção de nós, cópia e gráficos com mensagens de broker real permanece uma verificação manual; o teste estático de renderização não substitui essa validação.

Mantido o identificador textual usado pelos gráficos (`tópico.campo`): tópico contendo pontos e campo JSON com pontos ainda podem ser ambíguos nesse contrato. As identidades internas da árvore/React agora são separadas; esta correção não redesenha o endereçamento dos gráficos. Não foram adicionados limites de profundidade/tamanho para payload JSON, nem resolvidos os demais achados A02–A07.

Nenhum ErrorBoundary foi usado como substituto da correção. Não há alegação de ganho de desempenho, nem ensaio nativo Serial nesta tarefa.
