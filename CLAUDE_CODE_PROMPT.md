<details>
<summary>💬 Prompt buat Claude — copy dari sini</summary>

```
Bantu saya build dan deploy web app "Meta Ads Creative Generator".

Project ada di folder ini:
/Users/siscaliman/Documents/Claude/Projects/Ads creative generator

Skeleton code sudah ada (backend Express + frontend Next.js).
Baca dulu struktur project-nya sebelum mulai.

TECH STACK:
- Frontend: Next.js 14 + TypeScript + Tailwind + shadcn/ui → Vercel
- Backend: Node.js + Express → Railway (Docker)
- AI: apimart.ai (image gen, video gen, vision, chat)

2 FITUR UTAMA:

1. SCALING KONTEN WINNING (/scale)
   User upload iklan winning (gambar/video) → AI analisis style & pola →
   generate N variasi baru dengan angle berbeda (FOMO, Social Proof,
   Before-After, Tutorial, dll) → download hasil.
   Support image dan video.

2. CREATE WITH REFERENCE (/create)
   User upload referensi iklan + isi info produk mereka → AI combine
   style referensi + info produk → generate iklan baru siap naik Meta Ads.
   Wizard 5 step. Support single image, video, dan carousel.

YANG PERLU DIKERJAKAN:
1. Baca semua file yang sudah ada di project
2. Lengkapi frontend: dashboard, /scale, /create, /history, navbar,
   dan semua komponen ads yang belum ada
3. Pastikan semua API backend berjalan (routes/scale.js & routes/create.js)
4. Install dependencies di backend dan frontend
5. Test lokal — minta saya isi APIMART_API_KEY sebelum test
6. Deploy backend ke Railway, frontend ke Vercel
7. Update CORS setelah dapat kedua URL
8. Smoke test production

Mulai dari baca struktur project. Tanya saya sebelum lanjut ke setiap
step penting.
```

</details>
