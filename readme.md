# Dokumentasi Struktur Script & Landing Page Pembaruan WhatsApp

Landing page ini dirancang dengan gaya modern berbasis **Glassmorphic UI**, transisi layar yang mulus, animasi latar belakang yang lambat (smooth), serta pembatasan input yang ketat demi menjaga keamanan data pelanggan.

---

## 📂 Struktur Penyimpanan Berkas (Folder Structure)

Projek ini disusun secara modular untuk memudahkan pengelolaan kode secara terpisah:

```text
ujicoba/
├── index.html              # Struktur utama (HTML5) & Element SEO
├── README.md               # Dokumentasi dan panduan kode (File ini)
├── google_apps_script.js   # Script backend untuk Google Spreadsheet (Apps Script)
├── css/
│   └── style.css           # Desain UI, Responsivitas, dan Animasi Bergerak
├── js/
│   └── app.js              # Logika interaksi, Validasi Tiket, & Retriksi Input WA
└── assets/
    └── background.png      # Gambar latar belakang abstrak dengan gradasi emerald
```

---

## 🔍 Penjelasan Setiap Script & Fungsinya

### 1. Struktur Halaman: `index.html`
Berkas ini bertindak sebagai kerangka dasar aplikasi. Menggunakan konsep **Single Page Application (SPA) State**, halaman ini dibagi menjadi 3 layar utama (Containers) yang ditampilkan secara bergantian secara interaktif:
*   **Progress Stepper (`.progress-container`)**: Bar penunjuk langkah di bagian atas kartu untuk menggambarkan tahapan user (Langkah 1: Verifikasi, Langkah 2: Isi Data, Langkah 3: Selesai).
*   **Layar Verifikasi Tiket (`#card-gate`)**: Layar pertama yang mendesak pengguna memasukkan kode tiket dengan format `FX-XXXXXX`. Sebelum memvalidasi tiket ini, form pengisian data di bawahnya disembunyikan secara rapat.
*   **Form Pembaruan WhatsApp (`#card-form`)**: Kartu utama tempat pengguna mengisi website, username, nama lengkap, nomor WhatsApp lama, dan nomor WhatsApp baru. Nomor tiket yang diinput pada langkah awal ditampilkan kembali di sini secara otomatis dan bersifat *read-only* (tidak dapat diubah).
*   **Layar Sukses (`#card-success`)**: Layar konfirmasi akhir lengkap dengan animasi ikon centang hijau yang berputar halus saat pengiriman berhasil disimulasikan.

---

### 2. Tampilan & Animasi Bergerak: `css/style.css`
Menangani seluruh gaya visual landing page agar terasa mewah, premium, dan interaktif.
*   **Latar Belakang Bergerak Halus (Smooth Background)**:
    *   **Animasi Background Pulse (`bgPulse`)**: Gambar background (`background.png`) secara perlahan mengalami perubahan skala (`scale(1.02)` ke `scale(1.08)`) berulang secara asinkron untuk menciptakan efek kedalaman.
    *   **Floating Blobs Animation (`floatSlow` & `floatReverse`)**: Tiga buah lingkaran besar dengan gradien warna mint/teal (`.blob-1`, `.blob-2`, `.blob-3`) melayang secara tidak beraturan dengan filter buram tinggi (`blur(80px)`). Hal ini menghasilkan visual cairan gradien yang bergerak sangat lembut (*smooth organic wave*).
*   **Aksen Glassmorphism**: Kartu utama menggunakan efek kaca buram (`backdrop-filter: blur(20px)`) dengan latar semi-transparan putih bersih, outline tipis yang elegan, dan bayangan lembut agar terlihat melayang di atas background.
*   **Interaksi Form & Peringatan**: Mengatur gaya glow hijau mint saat input difokuskan, serta menangani gaya warna merah menyala (`.border-error`) dan animasi munculnya pesan kesalahan (`.input-warning`).

---

### 3. Logika, Validasi, & Integrasi Google Spreadsheet: `js/app.js`
Script utama ini bertindak sebagai otak dari alur interaksi aplikasi:
*   **Validasi Tiket Gating (Strict Restriction)**:
    *   Format yang divalidasi adalah `FX-` diikuti oleh 6 karakter huruf/angka (Contoh: `FX-A1B2C3`). Menggunakan fungsi RegEx: `/^FX-[A-Z0-9]{6}$/i`.
    *   Jika salah, sistem memblokir akses ke halaman berikutnya secara ketat, memicu notifikasi peringatan merah, dan menggerakkan kartu dengan efek bergetar (**shake animation**) sebagai indikasi penolakan akses.
*   **Pengisian Website Manual**:
    *   Kolom input website menggunakan tipe text input biasa sehingga pelanggan dapat menuliskan nama domain mereka secara manual.
*   **Integrasi Google Spreadsheet (Real-Time Submit)**:
    *   Saat pengguna menekan tombol **Kirim Permintaan**, data form akan dikumpulkan dan dikirimkan secara langsung ke Google Apps Script Web App URL (`https://script.google.com/macros/s/AKfycbyzLbB_iT4C6asAu8BM8A7tifXamAim7W8p0IzV1Fsy-IIqOLWZzwz7pBpBncWuDEpO_g/exec`) melalui metode `POST` dengan enkoding data `application/x-www-form-urlencoded`.
    *   Menggunakan mode `no-cors` untuk memastikan pengiriman data berhasil dilakukan tanpa terhambat oleh kebijakan CORS (Cross-Origin Resource Sharing) bawaan browser.
*   **Restriksi Angka Nomor WhatsApp (Strict Number Only Input)**:
    Untuk bidang nomor WhatsApp lama (`#form-wa-old`) dan baru (`#form-wa-new`), script memastikan **hanya angka saja yang dapat masuk** melalui tiga lapis pengamanan:
    1.  *Keypress Event*: Membatalkan aksi pengetikan jika karakter yang diketik bukan angka (`0-9`), dan langsung menampilkan tooltip peringatan.
    2.  *Input Event*: Memindai isi kotak input secara langsung, kemudian menggunakan regex `.replace(/[^0-9]/g, '')` untuk membuang karakter non-angka secara real-time. Hal ini penting untuk menangani input dari keyboard virtual ponsel pintar.
    3.  *Paste Event*: Jika pengguna mencoba menempelkan teks panjang yang berisi huruf (misal: `+62-812-abc`), script akan menyaring teks tersebut dan hanya menempelkan angka-angkanya saja (`62812`) ke kursor saat itu.
*   **Transisi Antar Kartu**:
    Menggunakan kelas `.hidden` yang memanipulasi opasitas, pergeseran posisi sumbu Y (`translateY`), dan rotasi X 3D secara bertahap untuk transisi yang dinamis.

---

## 🚀 Cara Menjalankan Project & Integrasi Telegram Bot

### Langkah 1: Buat Bot Telegram Baru
1. Buka aplikasi Telegram, cari akun bot resmi **@BotFather**.
2. Kirim pesan `/newbot` ke **@BotFather**.
3. Ikuti panduan: masukkan Nama Bot Anda (misal: `Portal Update WA`) dan Username Bot (misal: `my_wa_update_bot` - harus diakhiri dengan kata `bot`).
4. **@BotFather** akan mengirimkan pesan berisi **HTTP API token**. Simpan token ini (format token seperti: `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`).

### Langkah 2: Pasang & Konfigurasikan Google Apps Script
1. Buka Google Spreadsheet baru atau yang sudah ada di akun Google Drive Anda.
2. Pada menu atas, klik **Ekstensi** (Extensions) $\rightarrow$ **Apps Script**.
3. Hapus seluruh kode default di editor, lalu buka berkas [google_apps_script.js](file:///c:/Users/KHELFINE/Downloads/ujicoba/google_apps_script.js), salin semua kodenya, dan tempelkan ke editor Apps Script Anda.
4. Pada bagian atas kode Apps Script, ganti teks `"MASUKKAN_TOKEN_BOT_TELEGRAM_ANDA_DI_SINI"` dengan **Token Bot Telegram** yang Anda dapatkan dari **@BotFather** pada Langkah 1.
5. Klik tombol **Simpan** (ikon disket).

### Langkah 3: Deploy Aplikasi Web & Hubungkan Webhook Telegram
1. Klik tombol **Terapkan** (Deploy) $\rightarrow$ **Penerapan baru** (New deployment).
2. Klik ikon roda gigi di samping "Pilih jenis", lalu pilih **Aplikasi Web** (Web App).
3. Atur konfigurasi wajib berikut:
   * **Jalankan sebagai (Execute as)**: Pilih **Saya (email Anda)**.
   * **Siapa yang memiliki akses (Who has access)**: Pilih **Siapa saja (Anyone)**. *(Catatan: Pilihan ini sangat penting agar Telegram dan landing page bisa mengirim data tanpa login).*
4. Klik **Terapkan**. Setujui izin akses otorisasi akun Google Anda.
5. Setelah berhasil, **Salin URL Aplikasi Web** yang diberikan (URL berakhir dengan `/exec`).
6. Tempelkan URL tersebut ke:
   * Berkas [js/app.js](file:///c:/Users/KHELFINE/Downloads/ujicoba/js/app.js) pada variabel `const SCRIPT_URL = 'URL_APLIKASI_WEB_ANDA';` di bagian paling atas.
   * Berkas Apps Script di Spreadsheet Anda pada baris paling bawah di variabel `var webAppUrl = "URL_APLIKASI_WEB_ANDA";`.
7. **Jalankan Webhook**: Di menu atas editor Apps Script, pilih fungsi **`registerTelegramWebhook`** dari menu dropdown fungsi, lalu klik tombol **Jalankan** (Run). Pastikan status di log menunjukkan hasil sukses (`"ok": true`).

### Langkah 4: Uji Coba Alur Kerja Sistem
1. Masuk ke Bot Telegram yang telah Anda buat, ketik `/start`.
2. Kirim pesan dengan format persis seperti berikut (salin teks di bawah ini):
   ```text
   Req Change Number
   Asset : KR8
   Username : Sulaiman122
   ```
3. Bot Telegram akan otomatis membalas dengan info pembuatan tiket, User ID Anda, nama Asset, Kode Tiket (misal: `FX-W8H3N1`), serta melampirkan **Link Portal** lokal Anda.
4. Klik **Link Portal** tersebut. Link ini akan otomatis mengarahkan Anda ke file `index.html` lokal dengan query parameter tiket, misalnya: `index.html?t=FX-W8H3N1`.
5. Halaman secara otomatis memverifikasi tiket tersebut ke Google Sheets:
   * **Jika Valid (Akses Pertama)**: Anda akan langsung masuk ke halaman input formulir dengan nomor tiket dan username yang otomatis terisi.
   * **Jika Link Dibuka Kembali (Akses Kedua)**: Browser Anda akan diblokir dan menampilkan kartu **Akses Ditolak** karena tiket telah kedaluwarsa/pernah dibuka sebelumnya.
6. Isi sisa formulir (Website, Nama Lengkap, No WA Lama, No WA Baru) lalu klik **Kirim Permintaan**. Data Anda akan masuk ke Spreadsheet secara real-time dan tiket akan otomatis terkunci (`USED`).
