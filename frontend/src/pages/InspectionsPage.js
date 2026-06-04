import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Eye, Plus, X } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { extinguisherAPI, inspectionAPI } from '../services/api';
import Pagination from '../components/Pagination';

const STATUSES = ['Scheduled', 'Completed', 'Requires Service', 'Failed'];
const EMPTY_FORM = {
  extinguisherId: '',
  inspectorName: '',
  inspectionDate: '',
  inspectionTime: '',
  findings: '',
  status: 'Scheduled',
  nextInspectionDate: '',
};

function statusBadge(status) {
  const map = { Scheduled: 'badge-yellow', Completed: 'badge-green', 'Requires Service': 'badge-orange', Failed: 'badge-red' };
  return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>;
}

export default function InspectionsPage() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [extinguishers, setExtinguishers] = useState([]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await inspectionAPI.list({ page, limit: 10, status: filterStatus });
      setItems(res.data.data);
      setPagination(res.data.pagination);
    } catch {
      toast.error('Failed to load inspections');
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus]);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { extinguisherAPI.list({ limit: 200 }).then((res) => setExtinguishers(res.data.data)).catch(() => {}); }, []);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, inspectionDate: new Date().toISOString().split('T')[0] });
    setErrors([]);
    setModal('create');
  };

  const openView = (item) => {
    setSelected(item);
    setModal('view');
  };

  const closeModal = () => {
    setModal(null);
    setSelected(null);
    setErrors([]);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors([]);
    try {
      await inspectionAPI.create(form);
      toast.success(form.status === 'Scheduled' ? 'Inspection scheduled' : 'Inspection recorded');
      closeModal();
      fetchItems();
    } catch (err) {
      const errs = err.response?.data?.errors || [err.response?.data?.message || 'Save failed'];
      setErrors(errs);
    } finally {
      setSaving(false);
    }
  };

  const f = (date) => (date ? format(new Date(date), 'dd MMM yyyy') : '-');

  return (
    <div>
      <div className="page-header">
        <div><h2>Inspections</h2><p>Schedule and track extinguisher inspections</p></div>
        <button className="btn btn-primary" onClick={openCreate}><Plus size={15} /> Schedule Inspection</button>
      </div>

      <div className="search-bar">
        <select className="form-control" style={{ width: 'auto' }} value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr><th>Extinguisher</th><th>Inspector</th><th>Date</th><th>Time</th><th>Status</th><th>Next Inspection</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7}><div className="empty-state"><ClipboardCheck /><h3>No inspections found</h3></div></td></tr>
            ) : items.map((item) => (
              <tr key={item.id}>
                <td><strong className="mono">{item.extinguisherCode}</strong></td>
                <td>{item.inspectorName}</td>
                <td>{f(item.inspectionDate)}</td>
                <td>{item.inspectionTime || '-'}</td>
                <td>{statusBadge(item.status)}</td>
                <td>{f(item.nextInspectionDate)}</td>
                <td><button className="btn-icon" title="View" onClick={() => openView(item)}><Eye size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination pagination={pagination} onPageChange={setPage} />
      </div>

      {modal === 'create' && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Schedule Inspection</h3>
              <button className="btn-icon" onClick={closeModal}><X size={16} /></button>
            </div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                {errors.length > 0 && <div className="alert alert-error">{errors.map((err, index) => <div key={index}>{err}</div>)}</div>}
                <div className="form-group">
                  <label className="form-label">Extinguisher *</label>
                  <select className="form-control" value={form.extinguisherId} onChange={(e) => setForm({ ...form, extinguisherId: e.target.value })} required>
                    <option value="">Select extinguisher...</option>
                    {extinguishers.map((extinguisher) => <option key={extinguisher.id} value={extinguisher.id}>{extinguisher.extinguisherCode} - {extinguisher.location}</option>)}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Inspector Name *</label>
                    <input className="form-control" value={form.inspectorName} onChange={(e) => setForm({ ...form, inspectorName: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Status *</label>
                    <select className="form-control" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} required>
                      {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Inspection Date *</label>
                    <input type="date" className="form-control" value={form.inspectionDate} onChange={(e) => setForm({ ...form, inspectionDate: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Inspection Time</label>
                    <input type="time" className="form-control" value={form.inspectionTime} onChange={(e) => setForm({ ...form, inspectionTime: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Next Inspection Date</label>
                    <input type="date" className="form-control" value={form.nextInspectionDate} onChange={(e) => setForm({ ...form, nextInspectionDate: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Findings</label>
                  <textarea className="form-control" value={form.findings} onChange={(e) => setForm({ ...form, findings: e.target.value })} rows={3} placeholder="Describe inspection findings..." />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Saving...</> : 'Save Inspection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal === 'view' && selected && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Inspection Details</h3>
              <button className="btn-icon" onClick={closeModal}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item"><label>Extinguisher</label><span className="mono">{selected.extinguisherCode}</span></div>
                <div className="detail-item"><label>Inspector</label><span>{selected.inspectorName}</span></div>
                <div className="detail-item"><label>Date</label><span>{f(selected.inspectionDate)}</span></div>
                <div className="detail-item"><label>Time</label><span>{selected.inspectionTime || '-'}</span></div>
                <div className="detail-item"><label>Status</label>{statusBadge(selected.status)}</div>
                <div className="detail-item"><label>Next Inspection</label><span>{f(selected.nextInspectionDate)}</span></div>
                <div className="detail-item"><label>Recorded</label><span>{f(selected.createdAt)}</span></div>
                {selected.findings && <div className="detail-item" style={{ gridColumn: '1/-1' }}><label>Findings</label><span>{selected.findings}</span></div>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
