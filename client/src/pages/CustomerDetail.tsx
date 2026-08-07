import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, dateIn, money, timeIn } from '../lib/api';
import { useActiveOrg, useOrgBase } from '../lib/auth';

type CustomerDetailResponse = {
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    notes: string | null;
    smsConsentAt: string | null;
    smsOptedOutAt: string | null;
    createdAt: string;
    bookings: {
      id: string;
      startsAt: string;
      status: string;
      seats: number;
      totalCents: number;
      serviceType: { name: string; color: string };
      staff: { name: string } | null;
    }[];
    stats: {
      total: number;
      attended: number;
      noShows: number;
      lifetimeCents: number;
    };
  };
};

export default function CustomerDetail() {
  const { customerId } = useParams();
  const base = useOrgBase();
  const org = useActiveOrg();
  const timezone = org?.organization.timezone ?? 'UTC';
  const currency = org?.organization.currency ?? 'USD';

  const [data, setData] = useState<CustomerDetailResponse['customer'] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<CustomerDetailResponse>(`${base}/customers/${customerId}`)
      .then((res) => setData(res.customer))
      .catch((err) => setError(err.message));
  }, [base, customerId]);

  if (error) return <div className="err">{error}</div>;
  if (!data) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/customers" className="sub">
            ← Customers
          </Link>
          <h1 style={{ marginTop: 6 }}>{data.name}</h1>
          <p className="sub">
            {data.email}
            {data.phone && ` · ${data.phone}`}
          </p>
        </div>
      </div>

      <div className="stats">
        <div className="card stat">
          <div className="label">Bookings</div>
          <div className="value">{data.stats.total}</div>
        </div>
        <div className="card stat">
          <div className="label">Attended</div>
          <div className="value">{data.stats.attended}</div>
        </div>
        <div className="card stat">
          <div className="label">No shows</div>
          <div className="value">{data.stats.noShows}</div>
        </div>
        <div className="card stat">
          <div className="label">Lifetime</div>
          <div className="value">{money(data.stats.lifetimeCents, currency)}</div>
        </div>
      </div>

      {data.smsOptedOutAt && (
        <div className="alert warn">
          This customer replied STOP and will not receive text messages. Only
          they can opt back in, by replying START.
        </div>
      )}

      <h2>History</h2>

      {data.bookings.length === 0 ? (
        <div className="card empty">No bookings yet.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Class</th>
                <th>With</th>
                <th>Status</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {data.bookings.map((booking) => (
                <tr key={booking.id}>
                  <td>
                    {dateIn(booking.startsAt, timezone)}
                    <div className="sub" style={{ fontSize: '.78rem' }}>
                      {timeIn(booking.startsAt, timezone)}
                    </div>
                  </td>
                  <td>
                    <span
                      className="swatch"
                      style={{ background: booking.serviceType.color }}
                    />
                    {booking.serviceType.name}
                  </td>
                  <td>{booking.staff?.name ?? '—'}</td>
                  <td>
                    <span className={`tag ${booking.status}`}>
                      {booking.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{money(booking.totalCents, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
