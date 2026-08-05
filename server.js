const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Built-in zero-dependency .env loader
const dotenvPath = path.join(__dirname, '.env');
if (fs.existsSync(dotenvPath)) {
  try {
    const envConfig = fs.readFileSync(dotenvPath, 'utf8');
    envConfig.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex === -1) return;
      
      const key = trimmed.slice(0, equalIndex).trim();
      let rawVal = trimmed.slice(equalIndex + 1).trim();
      
      if (rawVal.startsWith('"')) {
        const endQuoteIndex = rawVal.indexOf('"', 1);
        if (endQuoteIndex !== -1) rawVal = rawVal.slice(1, endQuoteIndex);
      } else if (rawVal.startsWith("'")) {
        const endQuoteIndex = rawVal.indexOf("'", 1);
        if (endQuoteIndex !== -1) rawVal = rawVal.slice(1, endQuoteIndex);
      } else {
        const hashIndex = rawVal.indexOf('#');
        if (hashIndex !== -1) rawVal = rawVal.slice(0, hashIndex).trim();
      }
      process.env[key] = rawVal;
    });
    console.log(`Successfully loaded environment configuration from ${dotenvPath}`);
  } catch (err) {
    console.warn('Warning: Failed to read .env file, using defaults:', err.message);
  }
}

const PORT = process.env.PORT || 3008;

// Postgres Pool Setup
const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'workspace',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres'
};

// Render and other public cloud database hosting require SSL connections
if (process.env.NODE_ENV === 'production' || process.env.DB_SSL === 'true') {
  poolConfig.ssl = {
    rejectUnauthorized: false
  };
}

const pool = new Pool(poolConfig);

// Test connection and initialize database schema
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('PostgreSQL Database connection error:', err.message);
  } else {
    console.log('PostgreSQL Database connected successfully. Server time:', res.rows[0].now);
    initDb();
  }
});

const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || 'easy-ov-default-secret-key-12345';

// Hashing Functions (Zero-Dependency Cryptography)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedValue) {
  try {
    const [salt, originalHash] = storedValue.split(':');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === originalHash;
  } catch (e) {
    return false;
  }
}

// JWT Encoding/Decoding (Zero-Dependency JWT)
function base64url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

function signJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
    
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token) {
  try {
    const [header, payload, signature] = token.split('.');
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
      
    if (signature !== expectedSignature) return null;
    return JSON.parse(base64urlDecode(payload));
  } catch (e) {
    return null;
  }
}

// Database Initialization (Create tables & Seed default admin)
async function initDb() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'user'
      )
    `);
    
    // Check if table is empty
    const checkRes = await pool.query('SELECT COUNT(*) FROM users');
    const count = parseInt(checkRes.rows[0].count);
    if (count === 0) {
      const hashedAdminPassword = hashPassword('admin');
      await pool.query(
        'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4)',
        ['admin', 'admin@example.com', hashedAdminPassword, 'admin']
      );
      console.log('Default admin user successfully seeded: user=admin, pass=admin');
    }
  } catch (err) {
    console.error('Failed to initialize database tables:', err.message);
  }
}

// Custom cookie-parser middleware (Zero-Dependency Cookie parsing)
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      if (key) req.cookies[key] = val;
    });
  }
  next();
});

// Helper: Escape XML characters
function escapeXml(unsafe) {
  if (unsafe === undefined || unsafe === null) return '';
  return unsafe.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Middleware: Authenticate User via JWT cookie
async function authenticateUser(req, res, next) {
  const token = req.cookies.jwt_token;
  if (!token) {
    return res.status(401).json({ success: false, error: 'Unauthorized: No session token found' });
  }
  
  const decoded = verifyJwt(token);
  if (!decoded || !decoded.userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid session token' });
  }
  
  try {
    const userRes = await pool.query('SELECT id, username, email, role FROM users WHERE id = $1', [decoded.userId]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Unauthorized: User does not exist' });
    }
    
    req.user = userRes.rows[0];
    next();
  } catch (err) {
    console.error('Authentication error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error during authentication' });
  }
}

// Middleware: Require Admin role
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Forbidden: Admin privilege required' });
  }
  next();
}

// Auth Endpoint: Login
app.post('/api/auth/login', async (req, res) => {
  const { loginField, password } = req.body;
  if (!loginField || !password) {
    return res.status(400).json({ success: false, error: 'Please enter username/email and password' });
  }
  
  try {
    const userRes = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [loginField.trim()]
    );
    
    if (userRes.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid username/email or password' });
    }
    
    const user = userRes.rows[0];
    const isMatch = verifyPassword(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid username/email or password' });
    }
    
    const token = signJwt({ userId: user.id });
    res.setHeader('Set-Cookie', `jwt_token=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`);
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Auth Endpoint: Logout
app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'jwt_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Auth Endpoint: Get current user
app.get('/api/auth/me', authenticateUser, (req, res) => {
  res.json({ success: true, user: req.user });
});

// Admin Endpoint: List Users
app.get('/api/admin/users', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const usersRes = await pool.query('SELECT id, username, email, role FROM users ORDER BY id ASC');
    res.json({ success: true, data: usersRes.rows });
  } catch (err) {
    console.error('List users error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Endpoint: Create User (Registration)
app.post('/api/admin/users', authenticateUser, requireAdmin, async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password || !role) {
    return res.status(400).json({ success: false, error: 'All registration fields (Username, Email, Password, Role) are required' });
  }
  
  try {
    const checkRes = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username.trim(), email.trim()]
    );
    if (checkRes.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Username or Email is already registered' });
    }
    
    const hashedPassword = hashPassword(password);
    await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4)',
      [username.trim(), email.trim(), hashedPassword, role]
    );
    
    res.json({ success: true, message: `User "${username}" registered successfully!` });
  } catch (err) {
    console.error('Create user error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Endpoint: Reset Password
app.post('/api/admin/users/:id/reset-password', authenticateUser, requireAdmin, async (req, res) => {
  const userId = req.params.id;
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: 'New password is required' });
  }
  
  try {
    const hashedPassword = hashPassword(password);
    const updateRes = await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedPassword, userId]
    );
    
    if (updateRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    res.json({ success: true, message: 'Password reset successfully!' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Endpoint: Delete User
app.delete('/api/admin/users/:id', authenticateUser, requireAdmin, async (req, res) => {
  const userId = req.params.id;
  if (parseInt(userId) === req.user.id) {
    return res.status(400).json({ success: false, error: 'You cannot delete your own admin account!' });
  }
  
  try {
    const deleteRes = await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    if (deleteRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    res.json({ success: true, message: 'User deleted successfully!' });
  } catch (err) {
    console.error('Delete user error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get active assembly lines
app.get('/api/assembly-lines', authenticateUser, async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT al.dbid, al.name 
      FROM assemblyline al
      WHERE al.status = 'ACTIVE'
        AND (
          EXISTS (
            SELECT 1 FROM assemblylinenode n 
            WHERE n.assemblyline_dbid = al.dbid AND n.devicename = 'TicketStart'
          )
          OR
          EXISTS (
            SELECT 1 FROM startmark sm 
            WHERE sm.assemblyline_dbid = al.dbid AND sm.type = 'TicketStart'
          )
        )
      ORDER BY al.name
    `;
    const result = await pool.query(query);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Error fetching assembly lines:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Generate XML Job Tickets
app.post('/api/generate', authenticateUser, async (req, res) => {
  try {
    const { mode, files, customColumns, assemblyLineRef, dateStr, subProperties, mainPropertyName, jobNameTemplate, writeToFolder, targetFolder } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files provided for generation.' });
    }
    if (!assemblyLineRef) {
      return res.status(400).json({ success: false, error: 'Assembly Line Reference is required.' });
    }

    const cleanDate = (dateStr || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const mainPropName = mainPropertyName || 'DLV';
    const generatedXmls = [];

    const buildJobName = (fileEntity, fileTask) => {
      let template = jobNameTemplate || '';
      if (!template) {
        template = mode === 'filelist' 
          ? 'FILELIST_TASK-{task}_EXEC-{date}' 
          : '{mainPropName}-{entity}_TASK-{task}_EXEC-{date}';
      }
      return template
        .replace(/{mainPropName}/g, mainPropName)
        .replace(/{entity}/g, fileEntity || '')
        .replace(/{task}/g, fileTask || '')
        .replace(/{date}/g, cleanDate);
    };

    if (mode === 'filelist') {
      // Merged Filelist Mode: Single XML
      const firstTask = files[0].task || 'Task';
      const firstEntity = files[0].entity || '';
      const jobName = buildJobName(firstEntity, firstTask);
      const xmlContent = generateFilelistXml(files, customColumns, assemblyLineRef, cleanDate, subProperties, mainPropName, jobName);
      const diskFilename = `${jobName}.xml`.replace(/[|]/g, '-');
      
      generatedXmls.push({
        filename: diskFilename,
        content: xmlContent
      });
    } else {
      // Individual Mode: One XML per file
      files.forEach(file => {
        const jobName = buildJobName(file.entity, file.task);
        const xmlContent = generateIndividualXml(file, customColumns, assemblyLineRef, cleanDate, subProperties, mainPropName, jobName);
        const diskFilename = `${jobName}.xml`.replace(/[|]/g, '-');
        
        generatedXmls.push({
          filename: diskFilename,
          content: xmlContent
        });
      });
    }

    // Write to folder if requested
    let savedPath = null;
    if (writeToFolder) {
      const outputDir = targetFolder || process.env.DEFAULT_OUTPUT_DIR || path.join(__dirname, 'Generated');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      for (const item of generatedXmls) {
        const fullPath = path.join(outputDir, item.filename);
        fs.writeFileSync(fullPath, item.content, 'utf8');
      }
      savedPath = outputDir;
    }

    res.json({
      success: true,
      message: `Successfully generated ${generatedXmls.length} Job Ticket(s).`,
      savedPath: savedPath,
      xmls: generatedXmls
    });

  } catch (err) {
    console.error('Error generating XMLs:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper for generating Single XML for multiple files (Filelist)
function generateFilelistXml(files, customColumns, assemblyLineRef, dateStr, subProperties, mainPropName = 'DLV', jobName) {
  const taskName = files.length > 0 ? files[0].task : 'Task';
  const xmlEscapedJobName = escapeXml(jobName);
  
  let subPropsStr = '';
  
  // File-specific subproperties (FileName and NumberJob)
  files.forEach(file => {
    subPropsStr += `    <SubProperty xsi:type="PropertyString">\n`;
    subPropsStr += `      <Name>FileName</Name>\n`;
    subPropsStr += `      <Value>${escapeXml(file.name)}</Value>\n`;
    subPropsStr += `    </SubProperty>\n`;
    subPropsStr += `    <SubProperty xsi:type="PropertyString">\n`;
    subPropsStr += `      <Name>NumberJob</Name>\n`;
    subPropsStr += `      <Value>${escapeXml(file.entity)}</Value>\n`;
    subPropsStr += `    </SubProperty>\n`;

    // Add custom columns values for each file
    if (customColumns && Array.isArray(customColumns)) {
      customColumns.forEach(colObj => {
        const colName = typeof colObj === 'string' ? colObj : colObj.name;
        const colType = typeof colObj === 'string' ? 'string' : colObj.type;
        const val = (file.customData && file.customData[colName]) || '';
        if (val) {
          let xsiType = 'PropertyString';
          if (colType === 'integer') xsiType = 'PropertyInteger';
          else if (colType === 'float') xsiType = 'PropertyFloat';
          
          subPropsStr += `    <SubProperty xsi:type="${xsiType}">\n`;
          subPropsStr += `      <Name>${escapeXml(file.name)}_${escapeXml(colName)}</Name>\n`;
          subPropsStr += `      <Value>${escapeXml(val)}</Value>\n`;
          subPropsStr += `    </SubProperty>\n`;
        }
      });
    }
  });

  // Task subproperty
  subPropsStr += `    <SubProperty xsi:type="PropertyString">\n`;
  subPropsStr += `      <Name>task</Name>\n`;
  subPropsStr += `      <Value>${escapeXml(taskName)}</Value>\n`;
  subPropsStr += `    </SubProperty>\n`;

  // Custom subproperties
  if (subProperties && Array.isArray(subProperties)) {
    subProperties.forEach(prop => {
      if (prop.name === 'task') return;
      let xsiType = 'PropertyString';
      if (prop.type === 'integer') xsiType = 'PropertyInteger';
      else if (prop.type === 'float') xsiType = 'PropertyFloat';
      
      subPropsStr += `    <SubProperty xsi:type="${xsiType}">\n`;
      subPropsStr += `      <Name>${escapeXml(prop.name)}</Name>\n`;
      subPropsStr += `      <Value>${escapeXml(prop.value)}</Value>\n`;
      subPropsStr += `    </SubProperty>\n`;
    });
  }

  let filesStr = '';
  files.forEach(file => {
    filesStr += `   <File Uri="${escapeXml(file.uri)}"/>\n`;
  });

  const fileAssemblyLine = (files.length > 0 && files[0].assemblyLine) ? files[0].assemblyLine : assemblyLineRef;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Job Name="${xmlEscapedJobName}">
  <Property xsi:type="PropertyList" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <Name>${escapeXml(mainPropName)}</Name>
${subPropsStr}  </Property>
  <RunList ID="">
${filesStr}  </RunList>
  <AssemblyLineReference>${escapeXml(fileAssemblyLine)}</AssemblyLineReference>
</Job>`;
}

// Helper for generating Single XML for a single file (Individual)
function generateIndividualXml(file, customColumns, assemblyLineRef, dateStr, subProperties, mainPropName = 'DLV', jobName) {
  const xmlEscapedJobName = escapeXml(jobName);
  
  let subPropsStr = '';
  
  // File-specific subproperties (FileName and NumberJob)
  subPropsStr += `    <SubProperty xsi:type="PropertyString">\n`;
  subPropsStr += `      <Name>FileName</Name>\n`;
  subPropsStr += `      <Value>${escapeXml(file.name)}</Value>\n`;
  subPropsStr += `    </SubProperty>\n`;
  subPropsStr += `    <SubProperty xsi:type="PropertyString">\n`;
  subPropsStr += `      <Name>NumberJob</Name>\n`;
  subPropsStr += `      <Value>${escapeXml(file.entity)}</Value>\n`;
  subPropsStr += `    </SubProperty>\n`;

  // Custom Table Columns
  if (customColumns && Array.isArray(customColumns)) {
    customColumns.forEach(colObj => {
      const colName = typeof colObj === 'string' ? colObj : colObj.name;
      const colType = typeof colObj === 'string' ? 'string' : colObj.type;
      const val = (file.customData && file.customData[colName]) || '';
      if (val) {
        let xsiType = 'PropertyString';
        if (colType === 'integer') xsiType = 'PropertyInteger';
        else if (colType === 'float') xsiType = 'PropertyFloat';
        
        subPropsStr += `    <SubProperty xsi:type="${xsiType}">\n`;
        subPropsStr += `      <Name>${escapeXml(colName)}</Name>\n`;
        subPropsStr += `      <Value>${escapeXml(val)}</Value>\n`;
        subPropsStr += `    </SubProperty>\n`;
      }
    });
  }

  // Task subproperty
  subPropsStr += `    <SubProperty xsi:type="PropertyString">\n`;
  subPropsStr += `      <Name>task</Name>\n`;
  subPropsStr += `      <Value>${escapeXml(file.task)}</Value>\n`;
  subPropsStr += `    </SubProperty>\n`;

  // Custom subproperties
  if (subProperties && Array.isArray(subProperties)) {
    subProperties.forEach(prop => {
      if (prop.name === 'task') return;
      let xsiType = 'PropertyString';
      if (prop.type === 'integer') xsiType = 'PropertyInteger';
      else if (prop.type === 'float') xsiType = 'PropertyFloat';
      
      subPropsStr += `    <SubProperty xsi:type="${xsiType}">\n`;
      subPropsStr += `      <Name>${escapeXml(prop.name)}</Name>\n`;
      subPropsStr += `      <Value>${escapeXml(prop.value)}</Value>\n`;
      subPropsStr += `    </SubProperty>\n`;
    });
  }

  const fileAssemblyLine = file.assemblyLine || assemblyLineRef;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Job Name="${xmlEscapedJobName}">
  <Property xsi:type="PropertyList" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <Name>${escapeXml(mainPropName)}</Name>
${subPropsStr}  </Property>
  <RunList ID="">
   <File Uri="${escapeXml(file.uri)}"/>
  </RunList>
  <AssemblyLineReference>${escapeXml(fileAssemblyLine)}</AssemblyLineReference>
</Job>`;
}

// API: Handle file uploads dynamically to target folder (Base64 JSON payload - zero dependencies)
app.post('/api/upload', authenticateUser, (req, res) => {
  try {
    const { targetFolder, files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded.' });
    }

    let folderPath = targetFolder || process.env.DEFAULT_OUTPUT_DIR || path.join(__dirname, 'uploads');
    
    // Clean up "file:///" prefix if present
    if (folderPath.startsWith('file:///')) {
      folderPath = folderPath.substring(8);
    } else if (folderPath.startsWith('file://')) {
      folderPath = folderPath.substring(7);
    }
    folderPath = decodeURIComponent(folderPath);

    // Create target directory if it doesn't exist
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const savedFiles = [];

    files.forEach(file => {
      const filePath = path.join(folderPath, file.name);
      // Decode Base64 string back to binary buffer
      const buffer = Buffer.from(file.base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);
      savedFiles.push(file.name);
    });

    res.json({
      success: true,
      message: `Successfully uploaded ${savedFiles.length} file(s).`,
      savedPath: folderPath,
      files: savedFiles
    });
  } catch (err) {
    console.error('Error saving uploaded files:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`XML Job Ticket Generator running at http://localhost:${PORT}`);
});
