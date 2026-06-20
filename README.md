# PrepWise

PrepWise is a browser-based mock interview coach with a small Node/Express backend for OpenAI-powered interview questions and final reports.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

3. Open `.env` and replace `your_openai_api_key_here` with your OpenAI API key:

   ```dotenv
   OPENAI_API_KEY=your_real_key_here
   ```

   `.env` is ignored by Git. Never put this key in `index.html`, `app.js`, `config.js`, or another browser file.

4. Start the app and backend together:

   ```bash
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000).

For automatic server restarts during development, run `npm run dev`.

The optional `OPENAI_MODEL` value in `.env` defaults to `gpt-5.4-mini`.
