# NEWS — quarto-tts-reader

> Entrada mais recente no topo. Histórico: entradas nunca são reescritas.
>
> **Convenção de timestamp**: formato `YYYY-MM-DD HH:MM`, Horário de Brasília (UTC-3, sem horário de verão). Data sozinha não é suficiente. **Atenção ao gotcha do fuso documentado no `CLAUDE.md`** — `TZ='America/Sao_Paulo'` devolve UTC no Git Bash do Windows; use `date` puro e confira que `%z` imprime `-0300`.

## 2026-07-26 11:31 — v1.1.0: texto de bloco aninhado, contraste em tema escuro, movimento reduzido, altura da barra

Correções a partir de uma auditoria independente por sete subagentes (relatório em `Mancano2026-MA-Thesis`, rodada de 2026-07-26). A auditoria confirmou os sete defeitos históricos como corrigidos, descartou corretamente as três alegações falsas herdadas de rodadas anteriores, e produziu quatro achados — três válidos, um com remédio perigoso. Duas omissões dela foram encontradas na revisão do relatório e também estão corrigidas aqui.

**Texto de bloco aninhado era perdido (omissão da auditoria, o defeito mais grave desta leva).** O filtro descartava todo elemento que contivesse outro bloco — regra criada para o `<blockquote><p>` do epígrafe, que de outro modo seria lido duas vezes. Mas `li` está no seletor, e numa lista aninhada o item pai contém um `li` filho: o texto próprio do pai (`<li>texto do pai<ul><li>filho</li></ul></li>`) não pertencia a bloco nenhum, **nunca era lido nem clicável**. Os dois casos são o mesmo problema visto de lados opostos: descartar quem contém perde texto, aceitar todos duplica. Substituído por um critério de **posse**: um bloco é dono dos nós de texto que não estão dentro de outro bloco, e só é bloco se possui algum texto. O blockquote sai sozinho (não possui texto próprio — tudo está no `<p>`), e o `li` pai entra possuindo exatamente o texto dele. Provado com traço dos dois casos antes de commitar.

**Contraste ilegível em tema escuro.** `.tts-sentence-active` pintava fundo `#e0f2fe` sem definir `color`, de modo que o texto herdava a cor do tema — quase-branco sobre azul-claro em temas escuros (`darkly`, `slate`, `dim`), contraste ~1.1:1: a frase sumia exatamente enquanto era lida. A auditoria apontou isso para `.tts-sentence-active`. **Não apontou que `.tts-block-active` tem o mesmo defeito** — e ali é pior, porque esse é o modo que os usuários das vozes remotas (as boas) veem na maior parte do tempo. Ambas passam a fixar `color: #0f172a`, com regra própria para links, que precisam continuar reconhecíveis como links enquanto destacados.

**`scrollIntoView` ignorava `prefers-reduced-motion`.** Rolagem suave a cada bloco é precisamente o tipo de movimento não solicitado que causa desconforto vestibular. Agora consulta a media query e salta em vez de animar quando o leitor pediu movimento reduzido.

**Altura da barra medida em vez de fixa.** O `padding-bottom: 72px` no `body` era constante, mas a barra tem `flex-wrap` e cresce ao quebrar os controles em telas estreitas — em celular pequeno, cobria a última linha do texto. Agora o script mede a barra e ajusta o padding, com `ResizeObserver` quando disponível e `resize` com debounce como alternativa. A regra CSS permanece como piso, para o instante antes de o script rodar e para o caso de ele não carregar.

**Robustez do `stallInterval`.** O id passa a ser capturado em variável local em vez de lido de volta da variável de módulo. Era inalcançável na prática (o `stopTimers()` roda antes de cada novo par ser armado), e a auditoria não respondeu à pergunta direta sobre isso; mas o acoplamento quebraria na próxima edição, não nesta.

**Recusado: tornar cada palavra focável por teclado.** A auditoria observou, corretamente, que os `<span>` de palavra não têm `tabindex` e que um usuário de teclado não consegue iniciar a leitura de uma palavra do meio do texto. O remédio óbvio seria **pior que o problema**: um capítulo desta dissertação tem milhares de palavras, e milhares de paradas de Tab tornariam a página inutilizável justamente para quem navega por teclado. Se for atacado, o caminho é navegação por bloco ou um atalho a partir do parágrafo focado — registrado no `TODO.md`, não implementado às pressas.

**Verificado**: sintaxe por `node --check`; lógica de posse provada por traço nos casos de epígrafe e lista aninhada; render do exemplo nos dois sentidos da flag (2 tags ligada, 0 desligada); versão 1.1.0 refletida no caminho dos assets. **Não verificado**: comportamento de áudio, como sempre.

## 2026-07-26 07:43 — Extração da dissertação e primeiro commit

Primeira versão da extensão. O código **não nasceu aqui**: veio de um bloco `{=html}` de ~520 linhas embutido no capítulo da Parte I da dissertação de mestrado do autor (`Mancano2026-MA-Thesis`, `3-texts/0102-.../Mancano2026-0102-MA-Theoretical-Framework.qmd`), onde tinha três problemas estruturais — funcionava só naquele capítulo, ficava exposto a edição acidental no meio da prosa (um typo `textContentds` chegou a entrar no index do git por uma tecla perdida), e iria ao ar no site público da tese num `publish` descuidado. Extraído conforme o plano `9-vers/plan/2026-07-26_Plano_Extracao_TTS_Reader_Extensao_Quarto.md` daquele repositório.

**Registro de procedência (não apagar):** antes da extração, o player passou por quatro rodadas de auditoria cruzada entre agentes de IA, e os defeitos encontrados moldaram o desenho atual. Vale listar, porque cada um virou uma decisão de código que parece arbitrária sem esta história:

1. A primeira versão reconstruía cada parágrafo a partir de `innerText` para envolver as palavras, o que **destruía toda a marcação a cada carregamento** — inclusive os links de citação (13 só no trecho verificado), itálicos e notas. Daí a travessia com `TreeWalker` sobre nós de texto.
2. As posições de destaque somavam o comprimento das palavras, enquanto o `onboundary` reporta coordenadas **com** os espaços — desvio de um caractere por palavra, apontando a palavra errada já na terceira. Daí o `data-offset` absoluto gravado na mesma travessia que constrói o texto falado, o que faz as duas coordenadas concordarem por construção.
3. `onend`/`onerror` tardios de utterances canceladas passavam pelos guards e faziam pular parágrafo. Daí a checagem de identidade `activeUtterance !== u`.
4. O contador de retry do watchdog era zerado pela própria chamada que deveria limitar, tornando o retry infinito. Daí o contador viajar como argumento.
5. `<blockquote><p>` casava duas vezes no seletor, fazendo todo epígrafe ser **lido duas vezes** e envolvido em spans aninhados. Daí o filtro que só aceita blocos folha.
6. O watchdog de travamento retomava do último offset mesmo sem progresso, o que com vozes remotas (que muitas vezes não disparam `onboundary`) **replicava o mesmo parágrafo a cada 3 segundos, indefinidamente**. Daí a exigência de progresso comprovado.
7. O CSS de destaque usava `padding` horizontal e `font-weight: bold` palavra a palavra, o que mudava a largura de cada palavra ao acender e **refluía a linha inteira** — o texto saltava durante a leitura. Daí a regra de layout que proíbe alterar a caixa da palavra, e o uso de `box-shadow`.

**Mudanças de desenho feitas na extração**, aprovadas por auditoria e não presentes na versão da dissertação: a barra de controles passa a ser construída em JavaScript (`createElement`) com `position: fixed`, em vez de HTML escrito à mão com `sticky` — o container do Quarto pode anular `sticky` num filho, e construir em JS dispensa `include-before-body`, cujo ponto de inserção é imprevisível. A preparação das palavras passa a ser **sob demanda** (ponteiro, clique, ou chegada da leitura) em vez de no carregamento; a alternativa considerada, um `MutationObserver`, foi **rejeitada por raciocínio**: envolver palavras é ela mesma uma mutação, e o observer dispararia com as próprias escritas, em loop. Acrescentado o fallback para vozes sem `onboundary` — se nenhum limite de palavra chega em 800ms, destaca-se o bloco inteiro em vez de deixar a interface parada parecendo travada. E o texto canônico passa a normalizar espaço em branco, o que elimina as quebras de linha que o Quarto insere no fonte HTML e que antes fragmentavam o destaque de frase em pontos sem sentido.

**Dois achados empíricos desta sessão, ambos contrariando auditoria externa e ambos verificados com render de verdade:**

- `quarto.doc.is_format('html:js')` **é válido** — uma auditoria alegou que o identificador não existiria e que o correto seria `'html'`. O identificador aparece no Lua que o próprio Quarto instala, e o sufixo `:js` é justamente o que exclui formatos HTML sem suporte a JavaScript.
- Os campos de `add_html_dependency` são `scripts`/`stylesheets` **no plural**, e a forma `{ path = ..., attribs = { defer = 'true' } }` funciona: o HTML gerado traz `defer="true"`. A mesma auditoria afirmara serem singulares, sem evidência.

E um erro meu, descoberto do jeito certo — rodando antes de escrever: **`example.qmd` tem de ficar na raiz do repositório.** Numa subpasta, sem `_quarto.yml`, o Quarto trata a pasta do documento como raiz do projeto, não acha `_extensions/` e falha com *"Could not find executable …/tts-reader"*, interpretando o nome do filtro como caminho de executável. Corrigido movendo o arquivo, que é como as extensões oficiais fazem.

**Verificado nesta sessão** (mecânico): sintaxe do JS por `node --check`; render do exemplo sem erro; assets copiados para `example_files/libs/quarto-contrib/tts-reader-1.0.0/`; `defer="true"` presente na tag; e o guard de publicação testado nos dois sentidos — **2 tags com a flag ligada, 0 com ela desligada**.

**NÃO verificado**: absolutamente todo o comportamento de áudio. Nenhum agente reproduz som nem clica em botão. Se a fala começa, se o pause retoma no lugar certo, se o clique numa palavra funciona, se o texto não salta, se o epígrafe é lido uma vez, se a degradação com voz remota funciona — tudo isso continua por verificar pelo autor, seguindo o roteiro escrito no `example.qmd`.

**Metadados de Execução**:
- **Data/Hora**: 2026-07-26 07:43 (Horário Local)
- **Agente**: Claude Code / Claude Opus 5 / VS Code
- **Mensagem do Commit**: "feat: extensao Quarto de leitura em voz alta, extraida da dissertacao"
- **Arquivos afetados**: `_extensions/tts-reader/{_extension.yml,tts-reader.lua,tts-reader.js,tts-reader.css}`, `example.qmd`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `NEWS.md`, `TODO.md`, `LICENSE`, `.gitignore`
