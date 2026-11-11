# Arquivos e editores: próximos passos

## Estado desta versão

`/acesso/arquivos` é uma área de apresentação. Documentos, Planilhas e PDF são placeholders desativados; ainda não há envio, armazenamento, leitura nem edição de arquivos. A futura biblioteca será compartilhada somente com membros autenticados do espaço.

## Sequência recomendada

1. **Biblioteca privada:** envio, download, pastas, busca, filtros e prévia dos formatos seguros. Guardar o conteúdo no R2 privado e os metadados no D1: espaço, nome, tipo, tamanho, versão, autora e datas.
2. **Acesso por espaço:** validar autenticação e participação no espaço no Worker em cada operação de listar, enviar, abrir, renomear, mover, excluir e restaurar. Nunca tornar o bucket público; downloads devem passar pela autorização do Worker ou por URL assinada de curta duração.
3. **Histórico e recuperação:** manter versões, lixeira e restauração. Ao salvar por um editor, comparar a versão-base com a versão atual e sinalizar conflitos antes de substituir alterações de outra pessoa.
4. **Editores no navegador:** servir os builds WebAssembly em rotas da mesma origem e carregá-los em uma integração isolada. Usar o contrato de host documentado pelo projeto para abrir bytes e receber o arquivo salvo; validar origem, janela e versão das mensagens.
5. **Sincronização colaborativa:** começar com salvamento versionado e tratamento de conflito. Edição simultânea em tempo real é uma etapa separada: o contrato de host não fornece, sozinho, sincronização multiusuário nem resolução de conflitos.
6. **Experiência e desempenho:** preservar os temas claro, escuro e sistema dos editores, envolvendo-os com a navegação Gama Work sem reescrever suas paletas. Revisar tamanho dos builds, cache, MIME `application/wasm`, acessibilidade e carregamento em dispositivos modestos.

## Licenças e identidade

Os repositórios de origem consultados oferecem o código sob **MIT ou Apache License 2.0**. Essas licenças permitem adaptação e distribuição, desde que as obrigações da licença escolhida sejam cumpridas. Cada distribuição deverá preservar os arquivos de licença, avisos de copyright e atribuições aplicáveis, além de registrar modificações quando exigido.

As licenças do código não concedem os nomes, logotipos nem outras marcas dos projetos. A integração deve remover a identidade de origem e usar nomes, ícones e materiais próprios do Gama Work. Fontes, ícones, modelos e demais ativos de terceiros podem ter termos separados; revisar e conservar suas atribuições antes de publicar cada build.

O recurso de OCR do editor de PDF possui dependências de modelos com licença própria e pode carregar arquivos grandes em memória. Deve ficar fora da primeira integração até que seus termos, tamanho e impacto de memória sejam avaliados.

Esta é uma leitura técnica dos avisos publicados nos repositórios, não um parecer jurídico. Antes de distribuir builds modificados, revisar os arquivos de licença e atribuição incluídos na versão exata usada.

## Fontes consultadas

- [Repositório de planilhas](https://github.com/storytold/gridcraft), [`LICENSE-MIT`](https://github.com/storytold/gridcraft/blob/main/LICENSE-MIT), [`LICENSE-APACHE`](https://github.com/storytold/gridcraft/blob/main/LICENSE-APACHE), [`NOTICE`](https://github.com/storytold/gridcraft/blob/main/NOTICE) e [termos de marca](https://github.com/storytold/gridcraft/blob/main/docs/brand/LICENSE-brand.txt).
- [Repositório de documentos](https://github.com/storytold/wordcraft), [`LICENSE-MIT`](https://github.com/storytold/wordcraft/blob/main/LICENSE-MIT), [`LICENSE-APACHE`](https://github.com/storytold/wordcraft/blob/main/LICENSE-APACHE), [`NOTICE`](https://github.com/storytold/wordcraft/blob/main/NOTICE) e [termos de marca](https://github.com/storytold/wordcraft/blob/main/docs/brand/LICENSE-brand.txt).
- [Repositório de PDF](https://github.com/storytold/pdfcraft), [`LICENSE-MIT`](https://github.com/storytold/pdfcraft/blob/main/LICENSE-MIT), [`LICENSE-APACHE`](https://github.com/storytold/pdfcraft/blob/main/LICENSE-APACHE), [`NOTICE`](https://github.com/storytold/pdfcraft/blob/main/NOTICE) e [termos de marca](https://github.com/storytold/pdfcraft/blob/main/docs/brand/LICENSE-brand.txt).
- [Contrato de integração com uma aplicação hospedeira](https://github.com/storytold/craft-libs/blob/main/crates/web-host/README.md).
