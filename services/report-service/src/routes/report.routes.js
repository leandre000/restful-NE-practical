const express = require('express');
const { Parser } = require('json2csv');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

function rowsToPdfBuffer(title, rows) {
  const body = [
    title,
    '',
    ...rows.map((row) => Object.entries(row).map(([key, value]) => `${key}: ${value ?? ''}`).join(' | ')),
  ].join('\n').replace(/[()\\]/g, '\\$&');

  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${body.length + 65} >>
stream
BT
/F1 10 Tf
40 760 Td
12 TL
(${body.split('\n').join(') Tj T* (')}) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000063 00000 n 
0000000122 00000 n 
0000000248 00000 n 
0000000401 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
471
%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

function sendCsv(res, data, filename) {
  if (!data.length) {
    return res.status(404).json({ success: false, message: 'No data found for this report' });
  }
  const parser = new Parser({ fields: Object.keys(data[0]) });
  const csv = parser.parse(data);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csv);
}



function sendPdf(res, data, filename, title) {
  if (!data.length) {
    return res.status(404).json({ success: false, message: 'No data found for this report' });
  }
  const pdf = rowsToPdfBuffer(title, data);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(pdf);
}

function sendReport(res, format, data, filename, title, meta = {}) {
  if (format === 'csv') return sendCsv(res, data, `${filename}.csv`);
  if (format === 'pdf') return sendPdf(res, data, `${filename}.pdf`, title);
  return res.json({ success: true, data, ...meta });
}

router.get('/expired', authenticate, async (req, res) => {
  const format = req.query.format || 'json';
  const result = await db.query(`
    SELECT e.extinguisher_code, e.serial_number, e.type, e.size, e.location, e.expiry_date, e.status,
           e.compliance_status, c.full_name AS customer_name, c.organization_name,
           EXTRACT(DAY FROM (NOW() - e.expiry_date::timestamp))::int AS days_overdue
    FROM extinguishers e
    JOIN customers c ON c.id = e.customer_id
    WHERE e.expiry_date < NOW() OR e.status = 'expired'
    ORDER BY e.expiry_date ASC
  `);

  return sendReport(res, format, result.rows, 'expired-extinguishers', 'Expired Fire Extinguishers', { total: result.rows.length });
});

router.get('/expiring-soon', authenticate, async (req, res) => {
  const days = parseInt(req.query.days || '90', 10);
  const format = req.query.format || 'json';
  const result = await db.query(`
    SELECT e.extinguisher_code, e.serial_number, e.type, e.size, e.location, e.expiry_date, e.compliance_status,
           c.full_name AS customer_name, c.organization_name,
           EXTRACT(DAY FROM (e.expiry_date::timestamp - NOW()))::int AS days_remaining
    FROM extinguishers e
    JOIN customers c ON c.id = e.customer_id
    WHERE e.expiry_date BETWEEN NOW() AND NOW() + ($1 || ' days')::interval
      AND e.status NOT IN ('decommissioned', 'expired')
    ORDER BY e.expiry_date ASC
  `, [days]);

  return sendReport(res, format, result.rows, `expiring-within-${days}-days`, 'Upcoming Expirations', { total: result.rows.length, daysWindow: days });
});

router.get('/customers', authenticate, async (req, res) => {
  const format = req.query.format || 'json';
  const result = await db.query(`
    SELECT c.customer_code, c.full_name, c.phone, c.email, c.organization_name, c.address, c.is_active,
           COUNT(e.id) AS total_extinguishers,
           COUNT(e.id) FILTER (WHERE e.status = 'active') AS active,
           COUNT(e.id) FILTER (WHERE e.status = 'expired' OR e.expiry_date < NOW()) AS expired,
           COUNT(e.id) FILTER (WHERE e.compliance_status = 'non_compliant') AS non_compliant,
           c.created_at
    FROM customers c
    LEFT JOIN extinguishers e ON e.customer_id = c.id
    GROUP BY c.id
    ORDER BY c.full_name ASC
  `);

  return sendReport(res, format, result.rows, 'facility-report', 'Registered Facilities', { total: result.rows.length });
});

router.get('/inspections', authenticate, async (req, res) => {
  const format = req.query.format || 'json';
  const from = req.query.from || '';
  const to = req.query.to || '';

  let where = 'WHERE 1=1';
  const params = [];
  if (from) {
    params.push(from);
    where += ` AND i.inspection_date >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    where += ` AND i.inspection_date <= $${params.length}`;
  }

  const result = await db.query(`
    SELECT i.inspection_date, i.inspection_time, i.inspector_name, i.status, i.findings, i.next_inspection_date,
           e.extinguisher_code, e.serial_number, e.type, e.size, e.location,
           c.full_name AS customer_name, c.organization_name
    FROM inspections i
    JOIN extinguishers e ON e.id = i.extinguisher_id
    JOIN customers c ON c.id = e.customer_id
    ${where}
    ORDER BY i.inspection_date DESC
  `, params);

  return sendReport(res, format, result.rows, 'inspections-report', 'Inspection Report', { total: result.rows.length });
});

router.get('/inspections/status-summary', authenticate, async (req, res) => {
  const result = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'Scheduled' AND inspection_date >= CURRENT_DATE) AS pending_inspections,
      COUNT(*) FILTER (WHERE status = 'Completed') AS completed_inspections,
      COUNT(*) FILTER (WHERE status = 'Scheduled' AND inspection_date < CURRENT_DATE) AS overdue_inspections
    FROM inspections
  `);

  res.json({ success: true, data: result.rows[0] });
});

router.get('/maintenance', authenticate, async (req, res) => {
  const format = req.query.format || 'json';
  const from = req.query.from || '';
  const to = req.query.to || '';

  let where = 'WHERE 1=1';
  const params = [];
  if (from) {
    params.push(from);
    where += ` AND m.service_date >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    where += ` AND m.service_date <= $${params.length}`;
  }

  const result = await db.query(`
    SELECT m.service_date, m.service_company, m.technician_name, m.action_taken, m.issues_identified,
           m.recommendations, m.status, m.cost, m.next_service_date, m.description,
           e.extinguisher_code, e.serial_number, e.type, e.size, e.location,
           c.full_name AS customer_name, c.organization_name
    FROM maintenance m
    JOIN extinguishers e ON e.id = m.extinguisher_id
    JOIN customers c ON c.id = e.customer_id
    ${where}
    ORDER BY m.service_date DESC
  `, params);

  return sendReport(res, format, result.rows, 'maintenance-report', 'Maintenance Report', { total: result.rows.length });
});

router.get('/maintenance/frequency', authenticate, async (req, res) => {
  const result = await db.query(`
    SELECT e.extinguisher_code, e.serial_number, COUNT(m.id) AS maintenance_count,
           MAX(m.service_date) AS last_maintenance_date
    FROM extinguishers e
    LEFT JOIN maintenance m ON m.extinguisher_id = e.id
    GROUP BY e.id
    ORDER BY maintenance_count DESC, last_maintenance_date DESC NULLS LAST
  `);

  res.json({ success: true, data: result.rows, total: result.rows.length });
});

router.get('/compliance', authenticate, async (req, res) => {
  const format = req.query.format || 'json';
  const result = await db.query(`
    SELECT e.extinguisher_code, e.serial_number, e.type, e.size, e.location, e.expiry_date,
           e.last_inspection_date, e.next_inspection_date, e.status, e.compliance_status,
           c.full_name AS customer_name, c.organization_name,
           EXTRACT(DAY FROM (e.expiry_date::timestamp - NOW()))::int AS days_to_expiry,
           COALESCE(MAX(esc.stage), 0) AS escalation_stage
    FROM extinguishers e
    JOIN customers c ON c.id = e.customer_id
    LEFT JOIN escalations esc ON esc.extinguisher_id = e.id AND esc.status = 'open'
    GROUP BY e.id, c.id
    ORDER BY e.compliance_status DESC, e.expiry_date ASC
  `);

  return sendReport(res, format, result.rows, 'compliance-report', 'Compliance Report', { total: result.rows.length });
});

router.get('/inventory/summary', authenticate, async (req, res) => {
  const result = await db.query(`
    SELECT
      COUNT(*) AS total_extinguishers,
      COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) AS daily_inventory_summary,
      COUNT(*) FILTER (WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)) AS monthly_inventory_summary,
      COUNT(*) FILTER (WHERE DATE_TRUNC('year', created_at) = DATE_TRUNC('year', CURRENT_DATE)) AS yearly_inventory_summary
    FROM extinguishers
  `);

  res.json({ success: true, data: result.rows[0] });
});

router.get('/audit', authenticate, authorize('admin'), async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '20', 10);
  const offset = (page - 1) * limit;
  const action = req.query.action || '';
  const entityType = req.query.entityType || '';

  let where = 'WHERE 1=1';
  const params = [];
  if (action) {
    params.push(`%${action}%`);
    where += ` AND al.action ILIKE $${params.length}`;
  }
  if (entityType) {
    params.push(entityType);
    where += ` AND al.entity_type = $${params.length}`;
  }

  const countRes = await db.query(`SELECT COUNT(*) FROM audit_logs al ${where}`, params);
  const total = parseInt(countRes.rows[0].count, 10);

  params.push(limit, offset);
  const result = await db.query(`
    SELECT al.*, u.first_name, u.last_name
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    ${where}
    ORDER BY al.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  res.json({
    success: true,
    data: result.rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.get('/summary', authenticate, async (req, res) => {
  const [extStats, custStats, inspectionStats, maintenanceStats] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'expired' OR expiry_date < NOW()) AS expired,
        COUNT(*) FILTER (WHERE status = 'serviced') AS serviced,
        COUNT(*) FILTER (WHERE compliance_status = 'non_compliant') AS non_compliant,
        COUNT(*) FILTER (WHERE compliance_status = 'critical') AS critical,
        COUNT(*) FILTER (WHERE compliance_status = 'warning') AS warning,
        COUNT(*) FILTER (WHERE expiry_date BETWEEN NOW() AND NOW() + INTERVAL '30 days') AS expiring_30d,
        COUNT(*) FILTER (WHERE expiry_date BETWEEN NOW() AND NOW() + INTERVAL '90 days') AS expiring_90d
      FROM extinguishers
    `),
    db.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_active) AS active FROM customers`),
    db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'Completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'Requires Service') AS requires_service,
        COUNT(*) FILTER (WHERE status = 'Failed') AS failed,
        COUNT(*) FILTER (WHERE status = 'Scheduled' AND inspection_date >= CURRENT_DATE) AS pending,
        COUNT(*) FILTER (WHERE status = 'Scheduled' AND inspection_date < CURRENT_DATE) AS overdue
      FROM inspections
      WHERE inspection_date >= NOW() - INTERVAL '30 days'
    `),
    db.query(`
      SELECT COUNT(*) AS total, COALESCE(SUM(cost), 0) AS total_cost
      FROM maintenance
      WHERE service_date >= NOW() - INTERVAL '30 days'
    `),
  ]);

  res.json({
    success: true,
    data: {
      extinguishers: extStats.rows[0],
      customers: custStats.rows[0],
      inspections_last30d: inspectionStats.rows[0],
      maintenance_last30d: maintenanceStats.rows[0],
    },
  });
});

module.exports = router;
