import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useOrgBase } from '../lib/auth';

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  smsConsentAt: string | null;
  smsOptedOutAt: string | null;
  _count: { bookings: number };
};

export default function Customers() {
  const base = useOrgBase();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' });
    if (search.trim()) params.set('search', search.trim());

    try {
      const res = await api.get<{ customers: CustomerRow[] }>(
        `${base}/customers?${params}`,
      );
      setCustomers(res.customers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load.');
    }
  }, [base, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p className="sub">{customers.length} shown</p>
        </div>
      </div>

      <div className="toolbar">
        <input
          placeholder="Search name, email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 280 }}
        />
      </div>

      {error && <div className="err">{error}</div>}

      {customers.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-mark" aria-hidden="true">◍</span>
          <p className="empty-title">No customers yet.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Bookings</th>
                <th>Texts</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <Link to={`/customers/${customer.id}`}>{customer.name}</Link>
                  </td>
                  <td>
                    {customer.email}
                    {customer.phone && (
                      <div className="sub" style={{ fontSize: '.78rem' }}>
                        {customer.phone}
                      </div>
                    )}
                  </td>
                  <td>{customer._count.bookings}</td>
                  <td>
                    {/* Opt-out is shown distinctly from "never consented":
                        they are very different answers to "why no text?" */}
                    {customer.smsOptedOutAt ? (
                      <span className="tag NO_SHOW">Opted out</span>
                    ) : customer.smsConsentAt ? (
                      <span className="tag CONFIRMED">Yes</span>
                    ) : (
                      <span className="tag CANCELLED">No consent</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
