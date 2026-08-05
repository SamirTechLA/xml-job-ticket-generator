# Easy OV JobTicket Generator

A sleek, premium, high-performance web application designed to manage, configure, and generate JDF XML Job Tickets for document assembly lines.

Built on a robust Node.js backend connected to a PostgreSQL database, this tool features a dynamic interface with automated filename metadata parsing, manual column spaces resizing, drag-and-drop file queues, live XML previews, and secure role-based session authentication with zero external npm library dependencies.

## 🚀 Key Features

* **Manual Column Spaces Resizing & Reordering**: Drag-resizable column grips to manually adjust the widths and spaces of all columns in real-time, plus column-shifting controls (`◀` and `▶`) to customize table layouts. Grid states persist in local profiles.
* **Vibrant HSL Themes**: Native high-contrast **Dark Mode** (glassmorphic cards on custom gray backdrop) and **Light Mode** (sleek, high-readability layout with orange accents) with theme preservation.
* **Interactive Files Queue**: Drag-and-drop file imports, file deletion controls, individual task modifiers, and check-all selection logic.
* **High-Fidelity PDF & Image Thumbnails**: Renders the first page of uploaded PDFs at crisp high-resolution (`300px` viewport, `90%` JPEG quality) using client-side offscreen HTML canvas engines (PDF.js). Hold mouse over a thumbnail to trigger high-fidelity zoom popovers.
* **Dynamic Tasks & Profile Presets**: Manage default task queues via animated selection menus and save, load, or delete settings presets in localStorage.
* **XML Customizability**: Define main XML property tags (e.g. `<Name>DLV</Name>`), customize job filename templates with dynamic tokens, and separate file inputs into structured `FileName` and `NumberJob` subproperties.
* **Zero-Dependency Security Core**:
  * PBKDF2 cryptography with dynamic 16-byte random hex salts for hashing passwords.
  * Custom signature validation for session management via secure `HS256` HTTP-Only JWT cookies.
  * Automatic schema checks and tables generation on database startup, seeding a default administrator account (`admin` / `admin`).
  * Endpoint protection middlewares ensuring only authenticated users can upload, generate, or query database collections.

---

## 💻 Tech Stack

* **Frontend**: HTML5, Vanilla JavaScript, CSS3 (Custom Variables, Flexbox/Grid, Animations), PDF.js (CDN).
* **Backend**: Node.js (V20+), Express.
* **Database**: PostgreSQL (PG Client).
* **Security & Auth**: HS256 JWT, PBKDF2 Password Hashing, HTTP-Only Cookie Session verification (zero NPM dependencies).

---

## 🛠️ Local Installation & Setup

1. **Clone the Repository**:
   ```bash
   git clone <your-github-repo-url>
   cd xml-job-ticket-generator
   ```

2. **Install Dependencies**:
   This project has a minimal dependency print (only Express and PostgreSQL client):
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory (based on the sample below) containing your Postgres database credentials and a secure secret for token signatures:
   ```env
   PORT=3008
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=workspace
   DB_USER=postgres
   DB_PASS=your_postgres_password
   JWT_SECRET=generate_a_long_secure_hex_key_here
   DEFAULT_OUTPUT_DIR=D:/OV_Folders/_DEMOS/Output
   ```

4. **Run the Application**:
   ```bash
   node server.js
   ```
   Open your browser and navigate to `http://localhost:3008`.
   *Log in with the default admin account: Username `admin` / Password `admin`.*

---

## 🌐 Guidelines for Public Deployment

When deploying this application to a public server (not just local workspace):

### 1. Update the Default Admin Password Immediately
Log in to the **Admin Console** using the default credentials (`admin`/`admin`) and reset the password to a strong value to prevent unauthorized access.

### 2. Configure a Reverse Proxy & SSL Termination (Nginx)
Do not expose the Node.js application port (`3008`) directly to the public internet. Deploy it behind a reverse proxy like **Nginx** or **Apache** to handle SSL/TLS certificate termination.
Example Nginx proxy configuration:
```nginx
server {
    listen 80;
    server_name jobticket.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name jobticket.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/jobticket.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/jobticket.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3008;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. Restrict Database Connections
Ensure that PostgreSQL port `5432` is firewalled and not publicly accessible. Allow only connections originating from the application server (e.g. `localhost` or local VPC network).

### 4. Enable Production Environment Settings
Configure your hosting system to run with `NODE_ENV=production`. This disables detailed stack traces in JSON error responses and ensures optimal application speed.

---

## 🐙 How to Publish to GitHub

1. **Initialize Local Repository**:
   ```bash
   git init
   ```
2. **Stage files and commit**:
   The local `.gitignore` will automatically prevent `.env` and `node_modules` from being tracked.
   ```bash
   git add .
   git commit -m "Initial commit: Job Ticket Generator with database connection and secure auth"
   ```
3. **Create a Remote GitHub Repository**:
   Create a new, empty repository on GitHub.
4. **Push local repository to remote**:
   ```bash
   git branch -M main
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```
