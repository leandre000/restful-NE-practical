import React, { useState } from 'react';
import { BarChart3, Download, FileText } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { reportAPI } from '../services/api';

const REPORT_TYPES = [
  { key: 'expired', label: 'Expired Extinguishers', desc: 'All extinguishers past their expiry date' },
  { key: 'expiring-soon', label: 'Upcoming Expirations', desc: 'Extinguishers expiring within the selected window' },
  { key: 'customers', label: 'Facility Report', desc: 'Registered facilities and extinguisher totals' },
  { key: 'inspections', label: 'Inspection Report', desc: 'Scheduled and completed inspections' },
  { key: 'maintenance', label: 'Maintenance Report', desc: 'Maintenance history and recommendations' },
  { key: 'compliance', label: 'Compliance Report', desc: 'Expired, critical and warning compliance status' },
];

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState('expired');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [days, setDays] = useState(90);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const paramsForReport = () => {
    const params = {};
    if (activeReport === 'expiring-soon') params.days = days;
    if (['inspections', 'maintenance'].includes(activeReport)) {
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
    }
    return params;
  };

  const fetchReport = async () => {
    setLoading(true);
    try {
      const apiMap = {
        expired: reportAPI.expired,
        'expiring-soon': reportAPI.expiringSoon,
        customers: reportAPI.customers,
        inspections: reportAPI.inspections,
        maintenance: reportAPI.maintenance,
        compliance: reportAPI.compliance,
      };
      const res = await apiMap[activeReport](paramsForReport());
      setData(res.data.data);
      setLoaded(true);
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const download = async (formatType) => {
    try {
      const res = await reportAPI.downloadReport(activeReport, formatType, paramsForReport());
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${activeReport}-${format(new Date(), 'yyyy-MM-dd')}.${formatType}`;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success(`${formatType.toUpperCase()} downloaded`);
    } catch {
      toast.error('Download failed');
    }
  };

  const renderPreview = () => {
    if (!loaded) return null;
    if (data.length === 0) return <div className="empty-state"><FileText /><h3>No data for this report</h3></div>;

    return (
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>{Object.keys(data[0]).map((key) => <th key={key}>{key}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((row, index) => (
              <tr key={index}>
                {Object.keys(data[0]).map((key) => <td key={key}>{String(row[key] ?? '-')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <div><h2>Reports</h2><p>Generate and export operational and compliance reports</p></div>
      </div>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Select Report</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {REPORT_TYPES.map((report) => (
              <button
                key={report.key}
                className={`nav-item ${activeReport === report.key ? 'active' : ''}`}
                onClick={() => { setActiveReport(report.key); setLoaded(false); setData([]); }}
                style={{ flexDirection: 'column', alignItems: 'flex-start', height: 'auto', padding: '10px 14px' }}
              >
                <span style={{ fontWeight: 600 }}>{report.label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{report.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Options</h3>
          {activeReport === 'expiring-soon' && (
            <div className="form-group">
              <label className="form-label">Days Window</label>
              <select className="form-control" value={days} onChange={(e) => setDays(e.target.value)}>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
            </div>
          )}
          {['inspections', 'maintenance'].includes(activeReport) && (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">From Date</label>
                <input type="date" className="form-control" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">To Date</label>
                <input type="date" className="form-control" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={fetchReport} disabled={loading}>
              {loading ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Generating...</> : <><BarChart3 size={15} /> Generate Report</>}
            </button>
            {loaded && data.length > 0 && (
              <>
                <button className="btn btn-secondary" onClick={() => download('csv')}><Download size={15} /> Export CSV</button>
                <button className="btn btn-secondary" onClick={() => download('pdf')}><Download size={15} /> Export PDF</button>
              </>
            )}
          </div>
          {loaded && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>{data.length} records found</p>}
        </div>
      </div>

      {renderPreview()}
    </div>
  );
}
