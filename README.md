# Era Bot

React + Vite frontend with a Python backend for Gemini chat.

## Local run

1. Install frontend dependencies:
   `npm install`
2. Install backend dependencies:
   `pip install -r requirements.txt`
3. Create `.env` from `.env.example` and add `GEMINI_API_KEY`
4. Start backend:
   `python assistant_backend_api.py`
5. Start frontend:
   `npm run dev`

## Vercel deploy

- Frontend is deployed as a normal Vite app.
- Backend is deployed as a Vercel serverless function through [api/index.py](./api/index.py).
- In Vercel Project Settings add:
  - `GEMINI_API_KEY`
- Do not use `VITE_GEMINI_API_KEY` in production because `VITE_*` variables are exposed to the browser.

## API behavior

- Local development uses `http://127.0.0.1:8000` by default.
- Production on Vercel uses relative routes:
  - `/api/health`
  - `/api/chat`
