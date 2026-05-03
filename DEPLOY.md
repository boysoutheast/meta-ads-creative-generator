# Deploy Instructions — Semua Autonomous

Semua step dikerjakan sendiri. Tidak ada step manual dari user.
Pakai Claude in Chrome MCP untuk semua browser action.

---

## STATUS AWAL

- [x] `backend/.env` sudah diisi (APIMART_API_KEY sudah ada)
- [x] `next build` pass
- [ ] GitHub repo → buat via `gh` CLI atau Claude in Chrome
- [ ] Railway deploy → via Claude in Chrome
- [ ] Vercel deploy → via Claude in Chrome

---

## STEP 1 — Test backend lokal

```bash
cd "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator/backend"
npm run dev &
sleep 3
curl -s http://localhost:4000/health
curl -s http://localhost:4000/api/scale/angles
```

Kalau 200 lanjut. Kalau gagal debug sampai fix.

---

## STEP 2 — Cek model tersedia di apimart.ai

```bash
curl -s https://apimart.ai/api/v1/models \
  -H "Authorization: Bearer $(grep APIMART_API_KEY /Users/siscaliman/Documents/Claude/Projects/Ads\ creative\ generator/backend/.env | cut -d= -f2)" \
  | python3 -m json.tool | grep '"id"'
```

Update `IMAGE_MODEL`, `VIDEO_MODEL`, `VISION_MODEL` di `backend/.env` sesuai hasil.
Restart backend setelah update.

---

## STEP 3 — Init git

```bash
cd "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator"
git init
git add .
git commit -m "feat: Meta Ads Creative Generator v1"
```

---

## STEP 4 — Buat GitHub repo via Claude in Chrome

Gunakan Claude in Chrome MCP. Navigasi ke https://github.com/new dan:
1. Isi nama repo: `meta-ads-creative-generator`
2. Set Private
3. Jangan centang initialize README
4. Klik Create repository
5. Ambil HTTPS remote URL dari halaman hasil (format: `https://github.com/USERNAME/meta-ads-creative-generator.git`)
6. Jalankan:

```bash
cd "/Users/siscaliman/Documents/Claude/Projects/Ads creative generator"
git remote add origin HTTPS_URL_DARI_GITHUB
git push -u origin main
```

---

## STEP 5 — Deploy Backend ke Railway via Claude in Chrome

Gunakan Claude in Chrome MCP. Navigasi ke https://railway.app/new dan:
1. Klik "Deploy from GitHub repo"
2. Pilih repo `meta-ads-creative-generator`
3. Klik Configure → set Root Directory: `backend`
4. Buka tab Variables → klik "Raw Editor" → paste semua ini sekaligus:

```
NODE_ENV=production
APIMART_API_KEY=sk-qyYanUXZlkZIbIz8Q7Ry7KfYrEeGo870WXgXiOyhfiJIZkAA
APIMART_BASE_URL=https://apimart.ai/api/v1
IMAGE_MODEL=dall-e-3
VIDEO_MODEL=runway-gen3
VISION_MODEL=gpt-4o
CHAT_MODEL=gpt-4o
MAX_FILE_SIZE_MB=50
FRONTEND_URL=https://PLACEHOLDER.vercel.app
```

5. Buka Settings → Networking → Generate Domain
6. Tunggu deploy selesai (lihat build logs)
7. Catat Railway URL → test: `curl https://RAILWAY_URL.railway.app/health`

---

## STEP 6 — Deploy Frontend ke Vercel via Claude in Chrome

Gunakan Claude in Chrome MCP. Navigasi ke https://vercel.com/new dan:
1. Import repo `meta-ads-creative-generator`
2. Set Root Directory: `frontend`
3. Tambah Environment Variable:
   - Key: `NEXT_PUBLIC_API_URL`
   - Value: `https://RAILWAY_URL.railway.app` (dari Step 5)
4. Klik Deploy
5. Tunggu build selesai
6. Catat Vercel URL

---

## STEP 7 — Update CORS Railway via Claude in Chrome

Buka Railway project → Variables → update:
```
FRONTEND_URL=https://VERCEL_URL.vercel.app
```
Railway akan auto-redeploy.

---

## STEP 8 — Smoke Test Production

```bash
curl https://RAILWAY_URL.railway.app/health
curl https://RAILWAY_URL.railway.app/api/scale/angles
```

Pakai Claude in Chrome buka Vercel URL dan test:
1. `/scale` → upload gambar dummy → verify halaman load OK
2. `/create` → buka wizard → verify step 1 load OK
3. `/history` → verify halaman kosong load OK

---

## LAPORAN AKHIR

Setelah semua selesai, lapor:
- Railway URL: ___
- Vercel URL: ___
- Health check result: ___
- Semua halaman load: ✅ / ❌
