const { Client } = require('pg');

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'workspace',
  user: 'postgres',
  password: 'postgres'
});

async function main() {
  try {
    await client.connect();
    
    // Get list of tables
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    console.log("Tables in workspace database:");
    console.log(tablesRes.rows.map(r => r.table_name));

    // Let's search for columns or tables that look like assembly line or status
    for (const row of tablesRes.rows) {
      if (row.table_name.toLowerCase().includes('assembly') || row.table_name.toLowerCase().includes('line')) {
        console.log(`\nTable ${row.table_name} found. Columns:`);
        const colsRes = await client.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_name = $1
        `, [row.table_name]);
        console.log(colsRes.rows);
        
        console.log(`\nRows in ${row.table_name}:`);
        const dataRes = await client.query(`SELECT * FROM "${row.table_name}" LIMIT 10`);
        console.log(dataRes.rows);
      }
    }
  } catch (err) {
    console.error("Error executing query:", err);
  } finally {
    await client.end();
  }
}

main();
