# SerialHub 🛠️

[![Status do Projeto](https://img.shields.io/badge/status-desenvolvimento%20ativo-green.svg)](https://github.com/WigoWigo10/SerialHub/issues)
[![Licença](https://img.shields.io/badge/license-MIT-blue.svg)](/LICENSE)
[![Construído com](https://img.shields.io/badge/construído%20com-Python%20&%20wxPython-orange.svg)](#)

Um kit de ferramentas multifuncional para gravação de firmware e comunicação serial com microcontroladores ESP8266 & ESP32.

![Imagem da Interface do SerialHub](images/gui.png)

> **Nota do Mantenedor:**
> Este projeto é um *fork* do aclamado [nodemcu-pyflasher](https://github.com/marcelstoer/nodemcu-pyflasher), criado originalmente por [Marcel Stör](https://github.com/marcelstoer). O objetivo deste fork é modernizar a base de código, expandir as funcionalidades para além da gravação de firmware e manter o projeto ativamente para a comunidade de IoT. Todo o crédito pelo trabalho fundamental e pela ideia original pertence a Marcel.

---

## ✨ Principais Funcionalidades

* **Interface Gráfica Simples:** Esqueça a linha de comando. Uma UI intuitiva para facilitar a gravação.
* **Detecção de Porta Serial:** Listagem automática das portas seriais disponíveis.
* **Configuração Flexível:** Ajuste fácil de Baud Rate, Modo de Flash e opção de apagar a memória.
* **Autocontido:** Executáveis para Windows e macOS que não exigem instalação de Python.
* **Console Integrado:** Visualize a saída do processo de gravação em tempo real.

---

## 🗺️ Roteiro (Roadmap)

**SerialHub** está em desenvolvimento ativo com o objetivo de se tornar uma ferramenta completa. Os próximos passos incluem:

-   [ ] **Terminal Serial Integrado:** Para visualizar e interagir com a saída do seu dispositivo após a gravação.
-   [ ] **Suporte Completo à Família ESP32:** Seleção explícita de chips (ESP32, S3, C3, etc.) e opções específicas.
-   [ ] **Gerenciador de Firmware:** Para baixar as versões mais recentes de firmwares populares (MicroPython, CircuitPython).
-   [ ] **Tema Escuro (Dark Mode):** Uma alternativa de interface para melhor conforto visual.
-   [ ] **Internacionalização (i18n):** Suporte para múltiplos idiomas.
-   [ ] **(Longo Prazo)** Refatoração do Frontend com tecnologias modernas como React + Electron.

---

## 🚀 Instalação

A maneira mais fácil de usar o **SerialHub** é baixar a versão mais recente para o seu sistema operacional na [página de Releases](https://github.com/SEU-USUARIO/SerialHub/releases). Não é necessário instalar, basta executar!

---

## 🤝 Como Contribuir

Contribuições são muito bem-vindas! Se você tem ideias para novas funcionalidades, encontrou um bug ou quer ajudar a desenvolver, este é o lugar certo.

Por favor, leia nosso guia de contribuição em `CONTRIBUTING.md` para começar.

---

## 📜 Licença

Este projeto é distribuído sob a licença **MIT**. Veja o arquivo [LICENSE](/LICENSE) para mais detalhes.