# PyLeet — LeetCode Practice in Python 🐍⚡

Practice LeetCode problems with an in-browser Python editor. Paste a problem URL, write your solution, and run it against test cases instantly.

## Features

- 🔗 **Paste any LeetCode URL** — fetches problem description, examples, and test cases
- 🐍 **Python code editor** — syntax highlighting, auto-brackets, Ctrl+Enter to run
- ✅ **Test runner** — runs your code against basic test cases in-browser
- 📱 **Mobile friendly** — fully responsive, works on phones and tablets
- 🆓 **100% free** — deploy to Vercel in 2 minutes

## How It Works

1. Paste a LeetCode problem URL (e.g., `https://leetcode.com/problems/two-sum/`)
2. Click **Fetch** — the problem loads with description and test cases
3. Write your Python solution in the editor
4. Click **Run** — your code runs against the example test cases
5. See pass/fail results instantly

> **Python runs entirely in your browser** via [Pyodide](https://pyodide.org/) (WebAssembly). No server needed for code execution!

## Deploy to Vercel (Free)

### Option 1: One-Click (Recommended)

1. Push this project to a GitHub repository
2. Go to [vercel.com](https://vercel.com) and sign up with GitHub
3. Click **"New Project"** → Import your GitHub repo
4. Click **Deploy** — that's it!

### Option 2: CLI

```bash
npm i -g vercel
cd leetcode-practice
vercel
```

Follow the prompts. Your site will be live in seconds.

## Local Development

```bash
# Using the Vercel CLI (recommended)
npx vercel dev

# Or with a simple HTTP server (API won't work, uses CORS proxy fallback)
npx http-server . -p 8080
```

## Project Structure

```
leetcode-practice/
├── index.html          # Main page
├── css/style.css       # Dark theme styles
├── js/app.js           # App logic (editor, runner, test parser)
├── api/leetcode.js     # Vercel serverless function (LeetCode API proxy)
├── vercel.json         # Vercel routing config
└── package.json        # Project metadata
```

## Tech Stack

| Technology          | Purpose                        |
| ------------------- | ------------------------------ |
| Vanilla HTML/CSS/JS | Frontend (zero build step)     |
| CodeMirror 5        | Python code editor             |
| Pyodide             | Python runtime via WebAssembly |
| Vercel Serverless   | LeetCode API proxy             |
