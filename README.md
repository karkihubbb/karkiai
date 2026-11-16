# KarkiAI

A responsive, minimal AI chat app powered by the Google Gemini API.

## Features

- Calm, professional light interface with restrained slate-blue accents
- Your supplied profile photo displayed as the account avatar
- New chats and local chat history
- Prompt suggestions and Markdown-friendly AI replies
- Mobile-responsive layout and keyboard-aware composer
- Gemini API key stays on the server (never put it in browser code)

## Run locally

1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env`.
3. Put your Google AI Studio key in `GEMINI_API_KEY` in `.env`.
4. Run `npm install` and then `npm start`.
5. Open `http://localhost:3000`.

## Deploy

Deploy this repository as a **Node web service** (not a static site). On Render, create a new Web Service connected to this repository, use `npm install` for the build command and `npm start` for the start command, then add `GEMINI_API_KEY` in the service's Environment settings. `GEMINI_MODEL` is optional; the default is `gemini-3.8-flash` and can be changed to a model available to your API key.

## Security

Do not commit `.env` or share your Gemini API key. Add the key only to the environment-variable settings of your hosting provider.
