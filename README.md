# Gama Work

Primeiro protótipo de uma plataforma interna para organizar clientes, atendimentos, agendas e tarefas por empresa. Cada empresa usa um espaço próprio, que pode ter nome, descrição, ícone e cor personalizados.

## Recursos desta primeira versão

- Landing page de apresentação em `/landing`; o sistema de equipes permanece em `/`.
- Conta com e-mail e senha, com entrada por Google preparada para receber as credenciais OAuth da Agência Gama.
- Cadastro com confirmação de senha, exibição e indicador de força; exige 12 caracteres, letras maiúsculas e minúsculas, número e símbolo.
- Espaços de trabalho isolados por empresa, com troca entre espaços, criação e personalização pela proprietária.
- Acesso por convite da proprietária, com papéis de proprietária, administradora e colaboradora.
- Convite inicial para os e-mails de administração definidos no segredo `INITIAL_ADMIN_EMAILS` do Worker.
- Cadastro de clientes, status, fidelização, retorno e histórico de atendimentos.
- Agenda da equipe e itens pessoais, além de lista de tarefas.
- Modelos editáveis de jornadas, aplicáveis aos clientes.
- Importação de clientes por CSV ou exportação do Notion em ZIP, com seleção e mapeamento de colunas.
- Exportação em JSON (dados do espaço) e CSV (lista de clientes).

## Stack

- React, TypeScript e Vite
- Cloudflare Workers com Static Assets
- Cloudflare D1 para autenticação e dados
- Hono, Better Auth e Drizzle ORM

## Rodar localmente

Instale as dependências e inicie o Vite com o plugin Cloudflare:

```bash
npm install
npm run dev
```

O login e as rotas de dados locais precisam de uma instância D1 e dos segredos `BETTER_AUTH_SECRET`, `INITIAL_ADMIN_EMAILS`, `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. `INITIAL_ADMIN_EMAILS` aceita uma lista separada por vírgulas, ponto e vírgula ou quebras de linha. O e-mail inicial da proprietária está definido como `empresa@agenciagama.com.br`. Veja `cloudflare.config.ts` e `migrations/0001_initial.sql`.

## Deploy

O projeto usa a CLI `cf` do Cloudflare. O deploy mantém os bindings do Worker configurados na conta da Agência Gama:

```bash
npm run build
npm run deploy
```

Antes do primeiro deploy, configure a base D1 e os segredos no ambiente da conta Cloudflare da Agência Gama. Não coloque credenciais em arquivos versionados. O domínio próprio pode ser vinculado numa etapa posterior.

## Identidade visual

As cores seguem o brandbook da Agência Gama: laranja `#F65A1E`, laranja escuro `#C94412`, grafite `#5F5B55`, branco `#F5F3EE` e preto `#131313`. A marca oficial é usada a partir de `public/gama-mark.png`. O protótipo usa Syne para títulos e Barlow Condensed para interface e conteúdo. A fonte Khavix indicada no brandbook não veio incluída nos arquivos, então não é usada nesta versão.

## Escopo do protótipo

Este primeiro corte prepara a estrutura para evolução gradual. Integração com WhatsApp, colaboração em documentos no estilo Notion e importação completa de todas as bases do Notion ficam para atualizações futuras.
