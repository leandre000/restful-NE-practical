const express = require('express');
const Joi = require('joi');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUSES = ['Scheduled', 'Completed', 'Requires Service', 'Failed'];

function today() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatInspection(row) {
  return {
    id: row.id,
    extinguisherId: row.extinguisher_id,
    extinguisherCode: row.extinguisher_code,
    inspectorId: row.inspector_id,
    inspectorName: row.inspector_name,
    inspectionDate: row.inspection_date,
    inspectionTime: row.inspection_time,
    findings: row.findings,
    status: row.status,
    nextInspectionDate: row.next_inspection_date,
    createdAt: row.created_at,
  };
}

const inspectionSchema = Joi.object({
  extinguisherId: Joi.string().uuid().required()
    .messages({ 'string.guid': 'Extinguisher ID must be a valid UUID' }),
  inspectorName: Joi.string()
    .pattern(/^[A-Za-zÀ-ÖØ-öø-ÿ\s'\-.]{2,200}$/)
    .required()
    .messages({ 'string.pattern.base': 'Inspector name must contain only letters, spaces, hyphens or apostrophes' }),
  inspectionDate: Joi.string().isoDate().required(),
  inspectionTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).optional().allow('', null)
    .messages({ 'string.pattern.base': 'Inspection time must be in HH:mm format' }),
  findings: Joi.string().min(5).max(2000).optional().allow('', null)
    .messages({ 'string.min': 'Findings must be at least 5 characters if provided' }),
  status: Joi.string().valid(...VALID_STATUSES).required(),
  nextInspectionDate: Joi.string().isoDate().optional().allow('', null),
});

router.post('/', authenticate, async (req, res) => {
  const { error, value } = inspectionSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: error.details.map((d) => d.message),
    });
  }

  const { extinguisherId, inspectorName, inspectionDate, inspectionTime, findings, status, nextInspectionDate } = value;
  const now = today();
  const inspectionDay = parseDate(inspectionDate);
  const dateErrors = [];

  if (status === 'Scheduled' && inspectionDay && inspectionDay < now) {
    dateErrors.push('Scheduled inspection date must be today or in the future');
  }

  if (status !== 'Scheduled' && inspectionDay && inspectionDay > now) {
    dateErrors.push('Completed inspection date cannot be in the future');
  }

  if (nextInspectionDate) {
    const nextDate = parseDate(nextInspectionDate);
    if (nextDate && inspectionDay && nextDate <= inspectionDay) {
      dateErrors.push('Next inspection date must be after the inspection date');
    }
  }

  if (dateErrors.length > 0) {
    return res.status(400).json({ success: false, message: 'Date validation failed', errors: dateErrors });
  }

  const extCheck = await db.query(
    'SELECT id, expiry_date, manufacture_date FROM extinguishers WHERE id = $1',
    [extinguisherId]
  );
  if (extCheck.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Extinguisher not found' });
  }

  const ext = extCheck.rows[0];
  const manufactureDate = parseDate(ext.manufacture_date);
  if (manufactureDate && inspectionDay && inspectionDay < manufactureDate) {
    return res.status(400).json({
      success: false,
      message: 'Inspection date cannot be before the extinguisher manufacture date',
    });
  }

  if (nextInspectionDate && ext.expiry_date) {
    const nextDate = parseDate(nextInspectionDate);
    const expiryDate = parseDate(ext.expiry_date);
    if (nextDate && expiryDate && nextDate >= expiryDate) {
      return res.status(400).json({
        success: false,
        message: 'Next inspection date must be before the extinguisher expiry date',
      });
    }
  }

  const result = await db.query(
    `INSERT INTO inspections
       (extinguisher_id, inspector_id, inspector_name, inspection_date, inspection_time, findings, status, next_inspection_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      extinguisherId,
      req.user.id,
      inspectorName,
      inspectionDate,
      inspectionTime || null,
      findings || null,
      status,
      nextInspectionDate || null,
      req.user.id,
    ]
  );

  if (status !== 'Scheduled') {
    const extinguisherStatus = status === 'Completed' ? 'active' : 'pending_inspection';
    await db.query(
      `UPDATE extinguishers SET
         last_inspection_date = $1,
         next_inspection_date = COALESCE($2, next_inspection_date),
         status = $3
       WHERE id = $4`,
      [inspectionDate, nextInspectionDate || null, extinguisherStatus, extinguisherId]
    );
  } else if (nextInspectionDate) {
    await db.query(
      `UPDATE extinguishers SET next_inspection_date = $1, status = 'pending_inspection' WHERE id = $2`,
      [nextInspectionDate, extinguisherId]
    );
  }

  await db.query(
    `INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, new_values)
     VALUES ($1,$2,'CREATE_INSPECTION','inspection',$3,$4)`,
    [req.user.id, req.user.email, result.rows[0].id, JSON.stringify(value)]
  );

  res.status(201).json({
    success: true,
    message: status === 'Scheduled' ? 'Inspection scheduled successfully' : 'Inspection recorded successfully',
    data: formatInspection(result.rows[0]),
  });
});

router.get('/', authenticate, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '10', 10)));
  const offset = (page - 1) * limit;
  const extinguisherId = req.query.extinguisherId || '';
  const status = req.query.status || '';

  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  let where = 'WHERE 1=1';
  const params = [];

  if (extinguisherId) {
    if (!/^[0-9a-f-]{36}$/i.test(extinguisherId)) {
      return res.status(400).json({ success: false, message: 'Invalid extinguisher ID format' });
    }
    params.push(extinguisherId);
    where += ` AND i.extinguisher_id = $${params.length}`;
  }
  if (status) {
    params.push(status);
    where += ` AND i.status = $${params.length}`;
  }

  const countRes = await db.query(`SELECT COUNT(*) FROM inspections i ${where}`, params);
  const total = parseInt(countRes.rows[0].count, 10);

  params.push(limit, offset);
  const result = await db.query(
    `SELECT i.*, e.extinguisher_code
     FROM inspections i
     JOIN extinguishers e ON e.id = i.extinguisher_id
     ${where}
     ORDER BY i.inspection_date DESC, i.inspection_time DESC NULLS LAST
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    success: true,
    data: result.rows.map(formatInspection),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.get('/:id', authenticate, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid inspection ID format' });
  }

  const result = await db.query(
    `SELECT i.*, e.extinguisher_code
     FROM inspections i
     JOIN extinguishers e ON e.id = i.extinguisher_id
     WHERE i.id = $1`,
    [req.params.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Inspection not found' });
  }

  res.json({ success: true, data: formatInspection(result.rows[0]) });
});

module.exports = router;
