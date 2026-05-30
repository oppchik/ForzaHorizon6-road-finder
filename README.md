# 🏎️ Forza Horizon 6 Road Finder

> Open-source tool for Forza Horizon 6 players to find unexplored roads on the map using computer vision.

## The Problem

Getting 100% road exploration in Forza Horizon requires driving every road on the map (500+). When you're at 99.8%, those last unexplored roads are tiny grey pixels nearly invisible on a TV screen. There are PC scripts for this, but **nothing for Xbox players** — until now.

## How It Works

1. Open the site on your phone while sitting in front of your TV
2. Enter your Xbox Gamertag to verify your profile
3. Take a screenshot of the map in-game (Xbox button → Share)
4. The screenshot auto-syncs to your phone's Xbox app / gallery
5. Upload it to the site with one tap
6. Computer vision highlights every unexplored road segment in neon pink/green
7. Pick up your controller and drive there

**Total time: ~15 seconds**

## Architecture

```
┌─────────────────┐      ┌─────────────────┐     ┌─────────────────┐
│   Next.js App   │────> │ Next.js API     │────>│  CV Service     │
│   (Vercel)      │      │  Routes         │     │  (Python/FastAPI│
│                 │<──── │  - /api/xbox    │<────│  + OpenCV)      │
│  Mobile-first   │      │  - /api/analyze │     │                 │
└─────────────────┘      └─────────────────┘     └─────────────────┘
                                │
                                ▼
                        ┌──────────────────┐
                        │   Xbox Live API  │
                        │  (OpenXBL)       │
                        │  - Profile lookup│
                        │  - Achievements  │
                        └──────────────────┘
```

## Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes + Python FastAPI microservice
- **CV**: OpenCV, NumPy, scikit-image
- **Deployment**: Vercel (frontend) + Railway/Render (CV service)
- **External API**: OpenXBL (Xbox Live data)

## Security

- No user data stored — screenshots processed in memory and discarded
- Rate limiting on all API endpoints
- File validation: type, size, dimensions
- CORS restricted to own domain
- No authentication required (read-only Xbox data)

## Local Development

```bash
# Frontend
cd frontend
npm install
cp .env.example .env.local
npm run dev

# CV Service
cd cv-service
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Environment Variables

```env
# frontend/.env.local
OPENXBL_API_KEY=your_key_here          # https://xbl.io
CV_SERVICE_URL=http://localhost:8000    # Python CV service
NEXT_PUBLIC_APP_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000
```

## Contributing

PRs welcome! See [CONTRIBUTING.md](./docs/CONTRIBUTING.md).

## License

MIT
