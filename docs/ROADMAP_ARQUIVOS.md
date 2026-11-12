# Arquivos e editores: próximos passos

## Estado desta versão

- A biblioteca privada usa Google Drive para conteúdo, pastas e revisões; D1 mantém metadados e IDs, além dos tokens OAuth criptografados. Operações passam pela API autenticada e validam participação no espaço.
- A proprietária conecta o Drive pela aba de sincronização; o Gama Work organiza cada empresa em `gama-work-files/<espaço>`. Sem conexão, a biblioteca oferece cópias locais no navegador e download, sem compartilhamento nem backup entre dispositivos.
- Pastas, busca, envio até 20 MiB, movimentação, renomeação, lixeira, restauração e exclusão permanente são manipulados na pasta privada do Drive. As últimas 50 revisões binárias ficam disponíveis para restauração e ocupam a cota da conta conectada.
- O editor de texto está incorporado em iframe same-origin. Ele abre arquivos do espaço, salva como versões e faz cópia de recuperação quando detecta conflito. Edição ao vivo simultânea continua fora do escopo.
- O editor usa um release WebAssembly fixado do projeto de origem. O build verifica o hash, remove o favicon e nome de produto do HTML hospedeiro e divide o WebAssembly em partes estáticas com menos de 25 MiB. Avisos MIT/Apache, NOTICE, atribuições e licenças de fontes ficam disponíveis em `/tools/text/licencas/`.
- Planilhas e PDF continuam placeholders.

## Sequência recomendada

1. **Editor de planilhas:** repetir o processo de release fixado, verificação de hash, licenças, identidade própria e integração host para o app aberto de planilhas.
2. **Editor de PDF:** integrar o release após revisar limites de memória, dependências de OCR e licenças dos modelos e componentes adicionais.
3. **Sincronização colaborativa:** avaliar edição simultânea e resolução de conflitos multiusuário, além do salvamento versionado já entregue.
4. **Experiência e desempenho:** otimizar o carregamento WebAssembly, medir consumo em dispositivos modestos e avaliar filtros, prévias seguras e recuperação de versões.
5. **Operação do Drive:** adicionar indicadores de cota da conta, recuperação após revogação do OAuth e fluxos de migração entre contas Google.

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
