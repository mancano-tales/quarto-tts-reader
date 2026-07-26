# TODO — quarto-tts-reader

> Log append-only. Item novo no topo de cada seção, com data+hora (Horário de Brasília) e quem criou/concluiu.

## Pendente

- **[2026-07-26 07:43 — Claude Opus 5]** **Verificação manual do player no navegador.** Nada do comportamento de áudio foi verificado: nenhum agente reproduz som nem clica em botão. Rodar `quarto render example.qmd --to html`, abrir no Edge e percorrer o roteiro escrito no próprio `example.qmd` — fala inicia; pause/resume retoma perto de onde parou; clique numa palavra começa dali; links de citação navegam sem iniciar a leitura; o texto **não** salta enquanto as palavras acendem; o epígrafe é lido **uma** vez; com voz "Natural"/"Online" o bloco inteiro destaca em vez de a interface travar. *Bloqueia o uso na dissertação.*

- **[2026-07-26 07:43 — Claude Opus 5]** **Instalar na dissertação (WP4 do plano).** Rodar `quarto add mancano-tales/quarto-tts-reader` em `Mancano2026-MA-Thesis`, registrar o filtro no `_quarto.yml` sob `format: html:` (liga em todos os capítulos de uma vez), ajustar `tools/preview-html-chapter.ps1` para passar `-M tts-reader-enabled=true`, confirmar que `tools/publish.ps1` **não** passa nada, e remover o bloco `{=html}` do capítulo `0102`. Lembrete de governança: o agente não faz staging de `.qmd` de `3-texts/` por conta própria, e deve usar `git commit --only` para não arrastar prosa do autor. *Depende da verificação manual acima.*

- **[2026-07-26 07:43 — Claude Opus 5]** **Registrar no meta-repositório.** Adicionar este repo ao `README.md` da raiz (papel: "Extensão Quarto de leitura em voz alta"; status: `ATIVO`) e ao `NEWS.md` da raiz, no mesmo commit. **Exige sessão própria na raiz e plano em `0-meta/plan/`** — não pode ser feito de uma sessão aberta na dissertação nem aqui.

## Prospectivo

- **[2026-07-26 11:31 — Claude Opus 5]** **Iniciar leitura a partir do teclado.** Hoje a barra é totalmente operável por teclado, mas não há como focar uma palavra do meio do texto e ler dali sem mouse (apontado em auditoria, 2026-07-26). **Não** resolver com `tabindex="0"` nas palavras: um capítulo tem milhares delas, e milhares de paradas de Tab tornariam a página inutilizável para quem navega por teclado — o remédio seria pior que o problema. Caminhos a avaliar: navegação por bloco (atalho que move o "cursor de leitura" entre blocos), ou ler a partir do elemento que já tem foco.


- **[2026-07-26 07:43 — Claude Opus 5]** Suporte a idioma por documento: hoje a voz é escolhida na barra e o `lang` vem da voz. Ler `lang` do documento e pré-selecionar uma voz compatível seria mais previsível para textos em português.

- **[2026-07-26 07:43 — Claude Opus 5]** Atalhos de teclado (espaço para play/pause, setas para bloco anterior/próximo), com cuidado para não sequestrar a digitação em campos de formulário.

- **[2026-07-26 07:43 — Claude Opus 5]** Persistir voz e velocidade escolhidas em `localStorage`, para não reconfigurar a cada render do preview.

- **[2026-07-26 07:43 — Claude Opus 5]** Avaliar tema escuro: as cores de destaque (`#facc15`, `#e0f2fe`) foram escolhidas sobre fundo claro e podem ficar ruins no tema escuro do Quarto.

## Concluído

- **[2026-07-26 07:43 — Claude Opus 5]** Extração do bloco `{=html}` da dissertação para extensão Quarto standalone: estrutura, filtro Lua com os dois guardas, porte do JS com preparação sob demanda / `position: fixed` / fallback de `onboundary`, CSS sem reflow, `example.qmd` como banco de testes, governança de IA (`CLAUDE.md`/`AGENTS.md`/`NEWS.md`/`README.md`/`TODO.md`), licença MIT e primeiro commit. Verificação mecânica completa; comportamento de áudio por verificar (ver Pendente).
