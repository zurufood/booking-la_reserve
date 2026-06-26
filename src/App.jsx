import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChefHat,
  CreditCard,
  Edit3,
  ExternalLink,
  LogIn,
  LogOut,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UsersRound,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react';
import { MAX_SEATS, DEPOSIT_PER_SEAT, PAYMENT_URL } from './lib/config';
import {
  formatDate,
  formatLongDate,
  formatMoney,
  getNextThursday,
  getThursdayOptions,
  isThursday,
} from './lib/dates';
import {
  createAdminReservation,
  createPublicReservation,
  deleteAdminReservation,
  depositOptions,
  fetchPublicAvailability,
  fetchReservations,
  getDepositLabel,
  updateAdminReservation,
} from './lib/reservations';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { menuSections } from './data/menu';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emptyAdminForm = {
  date: getNextThursday(),
  email: '',
  phone: '',
  seats: 2,
  depositPerSeat: DEPOSIT_PER_SEAT,
  depositStatus: 'a-payer',
};

function getRoute() {
  return window.location.pathname.startsWith('/admin') ? 'admin' : 'signup';
}

function App() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    function syncRoute() {
      setRoute(getRoute());
    }

    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  function navigate(event, path) {
    event.preventDefault();
    window.history.pushState({}, '', path);
    setRoute(getRoute());
  }

  return (
    <>
      <nav className="route-nav" aria-label="Navigation">
        <a className={route === 'signup' ? 'active' : ''} href="/inscription" onClick={(event) => navigate(event, '/inscription')}>
          Inscription
        </a>
        <a className={route === 'admin' ? 'active' : ''} href="/admin" onClick={(event) => navigate(event, '/admin')}>
          Admin
        </a>
      </nav>
      {route === 'admin' ? <AdminPage /> : <SignupPage />}
    </>
  );
}

function ConfigNotice({ mode }) {
  return (
    <main className="center-shell">
      <section className="setup-panel">
        <ShieldCheck size={34} aria-hidden="true" />
        <h1>Configuration Supabase requise</h1>
        <p>
          Renseigne les variables dans un fichier <code>.env</code>, puis exécute le script
          <code> supabase/schema.sql</code> dans ton projet Supabase.
        </p>
        <pre>{`VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_DEPOSIT_PAYMENT_URL=...
VITE_DEPOSIT_PER_SEAT=10`}</pre>
        <span>{mode === 'admin' ? 'Le dashboard sera disponible après connexion admin.' : 'La page publique sera active après connexion à la base.'}</span>
      </section>
    </main>
  );
}

function SignupPage() {
  const [availability, setAvailability] = useState([]);
  const [selectedDate, setSelectedDate] = useState(getNextThursday());
  const [form, setForm] = useState({ email: '', phone: '', seats: 2 });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [receipt, setReceipt] = useState(null);

  async function loadAvailability() {
    setLoading(true);
    setLoadError('');

    try {
      const nextAvailability = await fetchPublicAvailability();
      setAvailability(nextAvailability);

      const preferredDate =
        nextAvailability.find((item) => item.date === selectedDate) ||
        nextAvailability.find((item) => item.remainingSeats > 0) ||
        nextAvailability[0];

      if (preferredDate) {
        setSelectedDate(preferredDate.date);
      }
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isSupabaseConfigured) {
      loadAvailability();
    }
  }, []);

  const selectedAvailability = availability.find((item) => item.date === selectedDate);
  const remainingSeats = selectedAvailability?.remainingSeats ?? 0;
  const requestedSeats = Number(form.seats) || 0;
  const depositTotal = requestedSeats * DEPOSIT_PER_SEAT;

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setReceipt(null);
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  function validateSignup() {
    const nextErrors = {};

    if (!emailPattern.test(form.email.trim())) {
      nextErrors.email = 'Email invalide';
    }

    if (!form.phone.trim()) {
      nextErrors.phone = 'Téléphone requis';
    }

    if (!selectedDate || !isThursday(selectedDate)) {
      nextErrors.date = 'Choisis un jeudi';
    }

    if (!requestedSeats || requestedSeats < 1) {
      nextErrors.seats = 'Nombre de places invalide';
    } else if (requestedSeats > remainingSeats) {
      nextErrors.seats = `Il reste ${remainingSeats} place${remainingSeats > 1 ? 's' : ''}`;
    }

    if (remainingSeats < 1) {
      nextErrors.form = 'Ce jeudi est complet.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!validateSignup()) {
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      const nextReceipt = await createPublicReservation({
        date: selectedDate,
        email: form.email,
        phone: form.phone,
        seats: requestedSeats,
      });

      setReceipt(nextReceipt);
      await loadAvailability();
    } catch (error) {
      setErrors({ form: error.message });
    } finally {
      setSubmitting(false);
    }
  }

  if (!isSupabaseConfigured) {
    return <ConfigNotice mode="signup" />;
  }

  return (
    <main className="public-shell">
      <section className="public-header">
        <div>
          <p className="eyebrow">Restaurant éphémère</p>
          <h1>Réserver une table</h1>
          <p className="lead">
            Un jeudi par semaine, 24 places, menu unique et acompte à régler après inscription.
          </p>
        </div>
        <div className="capacity-badge">
          <UsersRound size={20} aria-hidden="true" />
          <span>{remainingSeats} places restantes</span>
        </div>
      </section>

      <div className="public-grid">
        <section className="menu-panel" aria-labelledby="menu-title">
          <div className="panel-heading compact-heading">
            <div>
              <p className="eyebrow">Menu</p>
              <h2 id="menu-title">Menu du jeudi</h2>
            </div>
            <ChefHat size={28} aria-hidden="true" />
          </div>
          <div className="menu-list">
            {menuSections.map((section) => (
              <article className="menu-section" key={section.title}>
                <h3>{section.title}</h3>
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="signup-panel" aria-labelledby="signup-title">
          <div className="panel-heading compact-heading">
            <div>
              <p className="eyebrow">Inscription</p>
              <h2 id="signup-title">Vos informations</h2>
            </div>
            <UtensilsCrossed size={28} aria-hidden="true" />
          </div>

          {loadError && (
            <div className="alert error-alert">
              <span>{loadError}</span>
              <button className="icon-text-button" type="button" onClick={loadAvailability}>
                <RefreshCw size={16} />
                Réessayer
              </button>
            </div>
          )}

          <form className="signup-form" onSubmit={handleSubmit}>
            <label className="field field-full">
              <span>Jeudi</span>
              <select
                value={selectedDate}
                onChange={(event) => {
                  setSelectedDate(event.target.value);
                  setReceipt(null);
                  setErrors({});
                }}
                disabled={loading || availability.length === 0}
                aria-invalid={Boolean(errors.date)}
              >
                {availability.map((item) => (
                  <option key={item.date} value={item.date} disabled={item.remainingSeats === 0}>
                    {formatLongDate(item.date)} - {item.remainingSeats} place
                    {item.remainingSeats > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
              {errors.date && <small>{errors.date}</small>}
            </label>

            <label className="field">
              <span>Email</span>
              <input
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
                placeholder="vous@email.fr"
                type="email"
                aria-invalid={Boolean(errors.email)}
              />
              {errors.email && <small>{errors.email}</small>}
            </label>

            <label className="field">
              <span>Téléphone</span>
              <input
                value={form.phone}
                onChange={(event) => updateField('phone', event.target.value)}
                placeholder="06 00 00 00 00"
                inputMode="tel"
                aria-invalid={Boolean(errors.phone)}
              />
              {errors.phone && <small>{errors.phone}</small>}
            </label>

            <label className="field">
              <span>Places</span>
              <input
                value={form.seats}
                onChange={(event) => updateField('seats', event.target.value)}
                min="1"
                max={Math.max(1, remainingSeats)}
                type="number"
                aria-invalid={Boolean(errors.seats)}
              />
              {errors.seats && <small>{errors.seats}</small>}
            </label>

            <div className="deposit-summary">
              <CreditCard size={18} aria-hidden="true" />
              <span>Acompte total</span>
              <strong>{formatMoney(depositTotal)}</strong>
            </div>

            {errors.form && <div className="alert error-alert field-full">{errors.form}</div>}

            <button className="primary-button field-full" type="submit" disabled={submitting || loading}>
              <CheckCircle2 size={18} />
              <span>{submitting ? 'Inscription...' : 'Valider l’inscription'}</span>
            </button>
          </form>

          {receipt && (
            <div className="success-panel">
              <CheckCircle2 size={24} aria-hidden="true" />
              <div>
                <strong>Inscription enregistrée</strong>
                <span>
                  {receipt.seats} place{receipt.seats > 1 ? 's' : ''} pour le{' '}
                  {formatLongDate(receipt.service_date)}.
                </span>
              </div>
              {PAYMENT_URL ? (
                <a className="payment-button" href={PAYMENT_URL} target="_blank" rel="noreferrer">
                  <CreditCard size={18} />
                  Régler l’acompte
                  <ExternalLink size={16} />
                </a>
              ) : (
                <span className="payment-missing">Lien de paiement non configuré.</span>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function AdminPage() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured) {
    return <ConfigNotice mode="admin" />;
  }

  if (authLoading) {
    return (
      <main className="center-shell">
        <div className="loading-panel">Connexion en cours...</div>
      </main>
    );
  }

  if (!session) {
    return <AdminLogin />;
  }

  return <AdminDashboard userEmail={session.user.email} />;
}

function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (loginError) {
      setError(loginError.message);
    }

    setLoading(false);
  }

  return (
    <main className="center-shell">
      <section className="login-panel">
        <ShieldCheck size={34} aria-hidden="true" />
        <h1>Connexion admin</h1>
        <form className="signup-form" onSubmit={handleLogin}>
          <label className="field field-full">
            <span>Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
          </label>
          <label className="field field-full">
            <span>Mot de passe</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
            />
          </label>
          {error && <div className="alert error-alert field-full">{error}</div>}
          <button className="primary-button field-full" type="submit" disabled={loading}>
            <LogIn size={18} />
            <span>{loading ? 'Connexion...' : 'Se connecter'}</span>
          </button>
        </form>
      </section>
    </main>
  );
}

function AdminDashboard({ userEmail }) {
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('tous');
  const [dateFilter, setDateFilter] = useState(getNextThursday());
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyAdminForm);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function loadReservations() {
    setLoading(true);
    setError('');

    try {
      const nextReservations = await fetchReservations();
      setReservations(nextReservations);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReservations();
  }, []);

  const serviceDates = useMemo(
    () => getThursdayOptions([form.date, dateFilter, ...reservations.map((item) => item.date)]),
    [dateFilter, form.date, reservations],
  );

  function getBookedSeats(date, exceptId = null) {
    return reservations
      .filter((reservation) => reservation.date === date && reservation.id !== exceptId)
      .reduce((total, reservation) => total + Number(reservation.seats), 0);
  }

  const selectedBookedSeats = getBookedSeats(dateFilter);
  const selectedRemainingSeats = Math.max(0, MAX_SEATS - selectedBookedSeats);
  const availableSeatsForForm = Math.max(0, MAX_SEATS - getBookedSeats(form.date, editingId));

  const filteredReservations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('fr-FR');

    return reservations
      .filter((reservation) => {
        const matchesQuery =
          !normalizedQuery ||
          [reservation.email, reservation.phone].join(' ').toLocaleLowerCase('fr-FR').includes(normalizedQuery);
        const matchesPayment =
          paymentFilter === 'tous' || reservation.depositStatus === paymentFilter;
        const matchesDate = !dateFilter || reservation.date === dateFilter;

        return matchesQuery && matchesPayment && matchesDate;
      })
      .sort((a, b) => `${a.date}-${a.createdAt}`.localeCompare(`${b.date}-${b.createdAt}`));
  }, [dateFilter, paymentFilter, query, reservations]);

  const stats = useMemo(() => {
    const visibleReservations = reservations.filter((reservation) => reservation.date === dateFilter);
    const paidReservations = visibleReservations.filter(
      (reservation) => reservation.depositStatus === 'paye',
    );

    return {
      reservationCount: visibleReservations.length,
      bookedSeats: visibleReservations.reduce((total, reservation) => total + reservation.seats, 0),
      paidSeats: paidReservations.reduce((total, reservation) => total + reservation.seats, 0),
      paidDeposits: paidReservations.reduce(
        (total, reservation) => total + reservation.seats * reservation.depositPerSeat,
        0,
      ),
    };
  }, [dateFilter, reservations]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  function resetForm() {
    setEditingId(null);
    setForm({ ...emptyAdminForm, date: getNextThursday() });
    setFormErrors({});
  }

  function validateAdminForm() {
    const nextErrors = {};
    const seats = Number(form.seats);
    const depositPerSeat = Number(form.depositPerSeat);

    if (!form.date || !isThursday(form.date)) {
      nextErrors.date = 'Choisis un jeudi';
    }

    if (!emailPattern.test(form.email.trim())) {
      nextErrors.email = 'Email invalide';
    }

    if (!form.phone.trim()) {
      nextErrors.phone = 'Téléphone requis';
    }

    if (!seats || seats < 1) {
      nextErrors.seats = 'Nombre invalide';
    } else if (seats > availableSeatsForForm) {
      nextErrors.seats = `Il reste ${availableSeatsForForm} place${
        availableSeatsForForm > 1 ? 's' : ''
      }`;
    }

    if (Number.isNaN(depositPerSeat) || depositPerSeat < 0) {
      nextErrors.depositPerSeat = 'Montant invalide';
    }

    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleAdminSubmit(event) {
    event.preventDefault();

    if (!validateAdminForm()) {
      return;
    }

    setSaving(true);
    setFormErrors({});

    const payload = {
      date: form.date,
      email: form.email,
      phone: form.phone,
      seats: Number(form.seats),
      depositPerSeat: Number(form.depositPerSeat),
      depositStatus: form.depositStatus,
    };

    try {
      const savedReservation = editingId
        ? await updateAdminReservation(editingId, payload)
        : await createAdminReservation(payload);

      setReservations((current) => {
        if (editingId) {
          return current.map((reservation) =>
            reservation.id === editingId ? savedReservation : reservation,
          );
        }
        return [...current, savedReservation];
      });
      setDateFilter(payload.date);
      resetForm();
    } catch (saveError) {
      setFormErrors({ form: saveError.message });
    } finally {
      setSaving(false);
    }
  }

  function editReservation(reservation) {
    setEditingId(reservation.id);
    setForm({
      date: reservation.date,
      email: reservation.email,
      phone: reservation.phone,
      seats: reservation.seats,
      depositPerSeat: reservation.depositPerSeat,
      depositStatus: reservation.depositStatus,
    });
    setFormErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function updateDepositStatus(id, depositStatus) {
    try {
      const updated = await updateAdminReservation(id, { depositStatus });
      setReservations((current) =>
        current.map((reservation) => (reservation.id === id ? updated : reservation)),
      );
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  async function removeReservation(id) {
    if (!window.confirm('Supprimer cette inscription ?')) {
      return;
    }

    try {
      await deleteAdminReservation(id);
      setReservations((current) => current.filter((reservation) => reservation.id !== id));
      if (editingId === id) {
        resetForm();
      }
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Dashboard admin</p>
          <h1>Inscriptions du jeudi</h1>
        </div>
        <div className="admin-actions">
          <span>{userEmail}</span>
          <button className="secondary-button" type="button" onClick={signOut}>
            <LogOut size={17} />
            Déconnexion
          </button>
        </div>
      </header>

      <section className="availability-strip" aria-label="Disponibilité">
        <div>
          <span>Places disponibles</span>
          <strong>
            {selectedRemainingSeats} / {MAX_SEATS}
          </strong>
        </div>
        <progress value={selectedBookedSeats} max={MAX_SEATS} aria-label="Places réservées" />
      </section>

      <section className="stats-grid" aria-label="Résumé">
        <article className="metric metric-blue">
          <UsersRound size={22} aria-hidden="true" />
          <div>
            <span>Inscriptions</span>
            <strong>{stats.reservationCount}</strong>
          </div>
        </article>
        <article className="metric metric-green">
          <CheckCircle2 size={22} aria-hidden="true" />
          <div>
            <span>Places réservées</span>
            <strong>{stats.bookedSeats}</strong>
          </div>
        </article>
        <article className="metric metric-amber">
          <CreditCard size={22} aria-hidden="true" />
          <div>
            <span>Acomptes payés</span>
            <strong>{stats.paidSeats}</strong>
          </div>
        </article>
        <article className="metric metric-ink">
          <CalendarDays size={22} aria-hidden="true" />
          <div>
            <span>Montant reçu</span>
            <strong>{formatMoney(stats.paidDeposits)}</strong>
          </div>
        </article>
      </section>

      {error && (
        <div className="alert error-alert page-alert">
          <span>{error}</span>
          <button className="icon-text-button" type="button" onClick={loadReservations}>
            <RefreshCw size={16} />
            Réessayer
          </button>
        </div>
      )}

      <div className="workspace">
        <section className="panel form-panel" aria-labelledby="admin-form-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{editingId ? 'Modification' : 'Admin'}</p>
              <h2 id="admin-form-title">
                {editingId ? 'Modifier une inscription' : 'Ajouter une inscription'}
              </h2>
            </div>
            {editingId && (
              <button className="icon-button" type="button" onClick={resetForm} aria-label="Annuler">
                <XCircle size={20} />
              </button>
            )}
          </div>

          <form className="reservation-form" onSubmit={handleAdminSubmit}>
            <label className="field field-full">
              <span>Jeudi</span>
              <select
                value={form.date}
                onChange={(event) => updateForm('date', event.target.value)}
                aria-invalid={Boolean(formErrors.date)}
              >
                {serviceDates.map((date) => {
                  const remaining = Math.max(0, MAX_SEATS - getBookedSeats(date, editingId));
                  const isCurrentDate = date === form.date;
                  return (
                    <option key={date} value={date} disabled={!isCurrentDate && remaining === 0}>
                      {formatLongDate(date)} - {remaining} place{remaining > 1 ? 's' : ''}
                    </option>
                  );
                })}
              </select>
              {formErrors.date && <small>{formErrors.date}</small>}
            </label>

            <label className="field">
              <span>Email</span>
              <input
                value={form.email}
                onChange={(event) => updateForm('email', event.target.value)}
                type="email"
                aria-invalid={Boolean(formErrors.email)}
              />
              {formErrors.email && <small>{formErrors.email}</small>}
            </label>

            <label className="field">
              <span>Téléphone</span>
              <input
                value={form.phone}
                onChange={(event) => updateForm('phone', event.target.value)}
                inputMode="tel"
                aria-invalid={Boolean(formErrors.phone)}
              />
              {formErrors.phone && <small>{formErrors.phone}</small>}
            </label>

            <label className="field">
              <span>Places</span>
              <input
                value={form.seats}
                onChange={(event) => updateForm('seats', event.target.value)}
                min="1"
                max={Math.max(1, availableSeatsForForm)}
                type="number"
                aria-invalid={Boolean(formErrors.seats)}
              />
              {formErrors.seats && <small>{formErrors.seats}</small>}
            </label>

            <label className="field">
              <span>Acompte par place</span>
              <input
                value={form.depositPerSeat}
                onChange={(event) => updateForm('depositPerSeat', event.target.value)}
                min="0"
                step="1"
                type="number"
                aria-invalid={Boolean(formErrors.depositPerSeat)}
              />
              {formErrors.depositPerSeat && <small>{formErrors.depositPerSeat}</small>}
            </label>

            <label className="field field-full">
              <span>Acompte</span>
              <div className="segmented-control" role="group" aria-label="Acompte">
                {depositOptions.map((option) => (
                  <button
                    className={form.depositStatus === option.value ? 'active' : ''}
                    key={option.value}
                    type="button"
                    onClick={() => updateForm('depositStatus', option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </label>

            {formErrors.form && <div className="alert error-alert field-full">{formErrors.form}</div>}

            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={resetForm}>
                Effacer
              </button>
              <button className="primary-button" type="submit" disabled={saving}>
                {editingId ? <Save size={18} /> : <Plus size={18} />}
                <span>{saving ? 'Enregistrement...' : editingId ? 'Enregistrer' : 'Ajouter'}</span>
              </button>
            </div>
          </form>
        </section>

        <section className="panel list-panel" aria-labelledby="admin-list-title">
          <div className="panel-heading list-heading">
            <div>
              <p className="eyebrow">Liste</p>
              <h2 id="admin-list-title">Inscriptions</h2>
            </div>
            <button className="secondary-button" type="button" onClick={loadReservations}>
              <RefreshCw size={17} />
              Actualiser
            </button>
          </div>

          <div className="filters">
            <label className="search-field">
              <Search size={18} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Rechercher"
              />
            </label>
            <label className="field compact-field">
              <span>Jeudi</span>
              <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
                {serviceDates.map((date) => (
                  <option key={date} value={date}>
                    {formatDate(date)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field compact-field">
              <span>Acompte</span>
              <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
                <option value="tous">Tous</option>
                {depositOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="reservation-list">
            {loading ? (
              <div className="empty-state">Chargement...</div>
            ) : filteredReservations.length === 0 ? (
              <div className="empty-state">
                <CalendarDays size={32} aria-hidden="true" />
                <strong>Aucune inscription</strong>
                <span>Les inscriptions du jeudi sélectionné apparaîtront ici.</span>
              </div>
            ) : (
              filteredReservations.map((reservation) => {
                const depositTotal = reservation.seats * reservation.depositPerSeat;

                return (
                  <article className="reservation-card" key={reservation.id}>
                    <div className="reservation-time">
                      <CalendarDays size={18} aria-hidden="true" />
                      <strong>{reservation.seats}</strong>
                      <span>place{reservation.seats > 1 ? 's' : ''}</span>
                    </div>

                    <div className="reservation-main">
                      <div className="reservation-title-row">
                        <h3>{reservation.email}</h3>
                        <span className={`status-pill status-${reservation.depositStatus}`}>
                          {getDepositLabel(reservation.depositStatus)}
                        </span>
                      </div>
                      <div className="reservation-meta">
                        <a href={`mailto:${reservation.email}`}>
                          <Mail size={15} aria-hidden="true" />
                          {reservation.email}
                        </a>
                        <a href={`tel:${reservation.phone}`}>
                          <Phone size={15} aria-hidden="true" />
                          {reservation.phone}
                        </a>
                        <span>
                          <CreditCard size={15} aria-hidden="true" />
                          {formatMoney(depositTotal)}
                        </span>
                      </div>
                    </div>

                    <div className="reservation-actions">
                      <select
                        aria-label={`Changer l'acompte de ${reservation.email}`}
                        value={reservation.depositStatus}
                        onChange={(event) => updateDepositStatus(reservation.id, event.target.value)}
                      >
                        {depositOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => editReservation(reservation)}
                        aria-label={`Modifier ${reservation.email}`}
                      >
                        <Edit3 size={18} />
                      </button>
                      <button
                        className="icon-button danger"
                        type="button"
                        onClick={() => removeReservation(reservation.id)}
                        aria-label={`Supprimer ${reservation.email}`}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
