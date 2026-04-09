# HAWL Pool Lifeguard Portal

Staff-only portal for HAWL Pool — The Hideaway at Walnut Lake.
**URL:** https://lifeguard.hawlpool.com

## Features
- Secure login with session management
- Dashboard: announcements, schedule, pay dates, quick docs
- Pay schedule with status tracking
- Document library (S3-backed uploads)
- Full admin panel with tabbed UI
- Mobile-first responsive design

## Stack
- **Backend:** Node.js / Express
- **Database:** PostgreSQL (Neon)
- **Sessions:** SQLite (connect-sqlite3)
- **File Storage:** AWS S3
- **Hosting:** Render

## Setup

### 1. Clone
```bash
git clone https://github.com/YOUR_ORG/hawl-lifeguard-portal.git
cd hawl-lifeguard-portal
npm install
```

### 2. Environment
Copy `env.example` to `.env` and fill in:
```
DATABASE_URL=postgresql://neondb_owner:npg_...@.../neondb?sslmode=require
SESSION_SECRET=<generate a long random string>
AWS_ACCESS_KEY_ID=<same IAM user as investor portal>
AWS_SECRET_ACCESS_KEY=<same IAM secret>
AWS_REGION=us-east-1
S3_BUCKET_NAME=hawl-lifeguard-portal
ADMIN_EMAIL=brant@brantborden.com
ADMIN_PASSWORD=ihatebash001
```

### 3. AWS S3 Bucket
Create a new bucket named `hawl-lifeguard-portal` in us-east-1:
- Block all public access: ✅
- The existing IAM user from the investor portal has the needed permissions

### 4. Run
```bash
npm run dev   # development
npm start     # production
```

### 5. Deploy to Render
- Connect GitHub repo to Render
- Use the `render.yaml` config
- Set secret env vars in Render dashboard:
  - `DATABASE_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `ADMIN_PASSWORD`

### 6. Custom Domain
Point `lifeguard.hawlpool.com` CNAME to your Render service URL.

## Admin Account
- **Email:** brant@brantborden.com
- **Password:** ihatebash001
- Created automatically on first boot

## Routes
| Route | Description |
|---|---|
| `/` | Redirects to login or dashboard |
| `/auth/login` | Staff login |
| `/auth/logout` | Sign out |
| `/auth/change-password` | Change password |
| `/portal` | Dashboard |
| `/portal/schedule` | Shift & event schedule |
| `/portal/pay` | Pay schedule |
| `/portal/documents` | Document library |
| `/portal/document/:id` | Download / view a document |
| `/admin` | Admin panel (admin only) |
