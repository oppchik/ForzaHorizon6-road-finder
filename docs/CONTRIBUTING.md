# Contributing to Forza Road Finder

Thanks for wanting to help! Here's how to get started.

## Setup

```bash
git clone https://github.com/your-username/forza-road-finder
cd forza-road-finder

# Frontend
cd frontend && npm install && cp .env.example .env.local

# CV Service
cd ../cv-service
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

## Running tests

```bash
# CV service
cd cv-service && pytest tests/ -v

# Frontend type-check
cd frontend && npm run type-check
```

## Calibrating colour ranges

When Forza Horizon 6 ships, the HSV colour ranges for unexplored roads
will need calibration. See `cv-service/calibrate.py`:

```bash
cd cv-service
python calibrate.py path/to/your/screenshot.png
```

Adjust the trackbars until only grey unexplored roads are highlighted,
then paste the printed values into `main.py`.

## Pull request guidelines

- Keep PRs focused — one feature or fix per PR
- Add/update tests for CV changes
- Don't commit `.env.local` or API keys
- Tag screenshot-confirmed changes with `[tested-on-fh6]`

## Reporting issues

Open an issue with:
- Your Xbox / screenshot details (resolution, HDR on/off)
- The problematic screenshot (crop out personal info)
- What the analyser returned vs what you expected
