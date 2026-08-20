import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useOrgBase } from '../lib/auth';
import { DataTable, PageHead, StatusPill, Toolbar } from '../components/layout';
import { EmptyState } from '../components/states';

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
      <PageHead title="Customers" lede={`${customers.length} shown`} />

      <Toolbar>
        <input
          placeholder="Search name, email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 280 }}
        />
      </Toolbar>

      {error && <div className="err">{error}</div>}

      {customers.length === 0 ? (
        /* Was a hand-built copy of the empty state, which had drifted from the
           shared one: no hint slot, and the card wrapper the others do not use. */
        <EmptyState hint={search.trim() ? 'Try a different search.' : undefined}>
          {search.trim() ? 'No customers match that search.' : 'No customers yet.'}
        </EmptyState>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <DataTable
            caption="Customers, with contact details and text-message consent"
            head={
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Bookings</th>
                <th>Texts</th>
              </tr>
            }
          >
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
                    <StatusPill status="NO_SHOW">Opted out</StatusPill>
                  ) : customer.smsConsentAt ? (
                    <StatusPill status="CONFIRMED">Yes</StatusPill>
                  ) : (
                    <StatusPill status="CANCELLED">No consent</StatusPill>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </>
  );
}
