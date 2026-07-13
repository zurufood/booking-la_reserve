import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Edit3,
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
  XCircle,
} from 'lucide-react';
import { MAX_SEATS } from './lib/config';
import {
  NEXT_SERVICE_DATE,
  formatDate,
  formatDateTime,
  formatEventDate,
  formatLongDate,
  getThursdayOptions,
  isThursday,
} from './lib/dates';
import {
  cancelReservation,
  confirmReservation,
  createAdminReservation,
  createPublicReservation,
  deleteAdminReservation,
  fetchPublicAvailability,
  fetchReservations,
  getValidationStatusLabel,
  isReservationHoldingSeats,
  previewReservationCancellation,
  resendReservationSummary,
  updateAdminReservation,
  validationStatusOptions,
} from './lib/reservations';
import { isSupabaseConfigured, supabase } from './lib/supabase';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const frenchPhonePattern =
  /^(?:(?:\+|00)33[\s.-]?[1-9](?:[\s.-]?\d{2}){4}|0[1-9](?:[\s.-]?\d{2}){4})$/;
const PRESCREEN_DURATION_MS = 5000;
const PRESCREEN_FADE_MS = 900;
const PRESCREEN_IMAGE_SRC = '/affiche-preview.jpg';
const PRESCREEN_STORAGE_KEY = 'zuru-prescreen-seen-v1';

const emptySignupForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  seats: 2,
};

function hasSeenPrescreen() {
  try {
    return window.localStorage.getItem(PRESCREEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function markPrescreenSeen() {
  try {
    window.localStorage.setItem(PRESCREEN_STORAGE_KEY, 'true');
  } catch {
    // Storage may be unavailable in private browsing or locked-down contexts.
  }
}

function isFrenchPhoneNumber(value) {
  return frenchPhonePattern.test(value.trim());
}

const emptyAdminForm = {
  date: NEXT_SERVICE_DATE,
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  seats: 2,
};

function getRoute() {
  if (window.location.pathname.startsWith('/admin')) return 'admin';
  if (window.location.pathname.startsWith('/validation')) return 'validation';
  if (window.location.pathname.startsWith('/annulation')) return 'cancellation';
  return 'signup';
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

  if (route === 'admin') return <AdminPage />;
  if (route === 'validation') return <ValidationPage />;
  if (route === 'cancellation') return <CancellationPage />;
  return <SignupPage />;
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
VITE_SUPABASE_ANON_KEY=...`}</pre>
        <span>{mode === 'admin' ? 'Le dashboard sera disponible après connexion admin.' : 'La page publique sera active après connexion à la base.'}</span>
      </section>
    </main>
  );
}

function SignupPage() {
  const [availability, setAvailability] = useState([]);
  const [form, setForm] = useState(() => ({ ...emptySignupForm }));
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [duplicateReservation, setDuplicateReservation] = useState(null);
  const [resendingSummary, setResendingSummary] = useState(false);
  const [resendSummaryMessage, setResendSummaryMessage] = useState('');
  const [showPrescreen, setShowPrescreen] = useState(() => !hasSeenPrescreen());
  const [prescreenImageLoaded, setPrescreenImageLoaded] = useState(false);
  const [prescreenClosing, setPrescreenClosing] = useState(false);

  async function loadAvailability() {
    setLoading(true);
    setLoadError('');

    try {
      const nextAvailability = await fetchPublicAvailability();
      setAvailability(nextAvailability);
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

  useEffect(() => {
    if (showPrescreen) {
      markPrescreenSeen();
    }
  }, [showPrescreen]);

  useEffect(() => {
    if (!showPrescreen || !prescreenImageLoaded) {
      return undefined;
    }

    const fadeTimeoutId = window.setTimeout(() => {
      setPrescreenClosing(true);
    }, PRESCREEN_DURATION_MS);

    const hideTimeoutId = window.setTimeout(() => {
      setShowPrescreen(false);
    }, PRESCREEN_DURATION_MS + PRESCREEN_FADE_MS);

    return () => {
      window.clearTimeout(fadeTimeoutId);
      window.clearTimeout(hideTimeoutId);
    };
  }, [prescreenImageLoaded, showPrescreen]);

  const selectedAvailability = availability.find((item) => item.date === NEXT_SERVICE_DATE);
  const remainingSeats = selectedAvailability?.remainingSeats ?? 0;
  const requestedSeats = Number(form.seats) || 0;

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setReceipt(null);
    setDuplicateReservation(null);
    setResendSummaryMessage('');
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  function validateSignup() {
    const nextErrors = {};

    if (!form.lastName.trim()) {
      nextErrors.lastName = 'Nom complet requis';
    }

    if (!emailPattern.test(form.email.trim())) {
      nextErrors.email = 'Email invalide';
    }

    if (!form.phone.trim()) {
      nextErrors.phone = 'Téléphone requis';
    } else if (!isFrenchPhoneNumber(form.phone)) {
      nextErrors.phone = 'Numéro de téléphone français invalide';
    }

    if (!isThursday(NEXT_SERVICE_DATE)) {
      nextErrors.form = "Date d'inscription invalide";
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
      const reservation = await createPublicReservation({
        firstName: '',
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        seats: requestedSeats,
      });

      if (reservation?.status === 'duplicate') {
        setDuplicateReservation(reservation);
        setResendSummaryMessage('');
        return;
      }

      setReceipt(reservation);
      await loadAvailability();
    } catch (error) {
      setErrors({ form: error.message });
    } finally {
      setSubmitting(false);
    }
  }

  function startAnotherReservation() {
    setForm({ ...emptySignupForm });
    setErrors({});
    setReceipt(null);
    setDuplicateReservation(null);
    setResendSummaryMessage('');
    loadAvailability();
  }

  async function handleResendSummary() {
    if (resendingSummary) {
      return;
    }

    setResendingSummary(true);
    setErrors({});
    setResendSummaryMessage('');

    try {
      const result = await resendReservationSummary({ email: form.email });
      setResendSummaryMessage(
        result?.message || 'Le récapitulatif vient d’être renvoyé à cette adresse email.',
      );
    } catch (error) {
      setErrors({ form: error.message });
    } finally {
      setResendingSummary(false);
    }
  }

  if (!isSupabaseConfigured) {
    return <ConfigNotice mode="signup" />;
  }

  const isReservationVisible = prescreenClosing || !showPrescreen;
  const hiddenReservationProps = isReservationVisible ? {} : { inert: '', 'aria-hidden': 'true' };

  return (
    <>
      {showPrescreen && (
        <main
          className={`prescreen${prescreenClosing ? ' is-closing' : ''}`}
          aria-label="Affiche Zuru Zuru Supper Club"
        >
          <div className="prescreen-frame">
            <img
              className="prescreen-poster"
              src={PRESCREEN_IMAGE_SRC}
              alt="Affiche Zuru Zuru Supper Club du 16.07"
              onLoad={() => setPrescreenImageLoaded(true)}
              onError={() => setShowPrescreen(false)}
            />
            <div className="prescreen-progress" aria-hidden="true">
              <span
                className={
                  prescreenImageLoaded
                    ? 'prescreen-progress-fill is-active'
                    : 'prescreen-progress-fill'
                }
              />
            </div>
          </div>
        </main>
      )}

      <main
        className={`public-shell public-shell-transition${
          isReservationVisible ? ' is-visible' : ''
        }`}
        {...hiddenReservationProps}
      >
      <section className="public-header">
        <div className="public-title-block">
          <div className="brand-date-lockup">
            <img className="zuru-logo" src="/zuru-logo-v2.svg" alt="Zuru Zuru Supper Club" />
            <span className="brand-date-separator" aria-hidden="true" />
            <span className="event-date" aria-label={formatEventDate(NEXT_SERVICE_DATE)}>
              {formatEventDate(NEXT_SERVICE_DATE)}
            </span>
          </div>
          <p className="lead">
            Une table, des produits locaux, des ingrédients de saison, des vins choisis avec soin,
            des conversations qui rapprochent.
          </p>
          <p className="menu-timing">
            <span>Apéritif à partir de 18:00</span>
            <span className="menu-timing-separator" aria-hidden="true">
              /
            </span>
            <span>Début du dîner à 20:30</span>
          </p>
        </div>
      </section>

      <div className="public-grid">
        <section
          className={
            receipt || duplicateReservation
              ? 'signup-panel reservation-validation-panel'
              : 'signup-panel'
          }
          aria-labelledby="signup-title"
        >
          {!receipt && !duplicateReservation && (
            <span className="availability-badge" aria-live="polite">
              {loading
                ? '...'
                : `${remainingSeats} place${remainingSeats > 1 ? 's' : ''} restante${
                    remainingSeats > 1 ? 's' : ''
                  }`}
            </span>
          )}
          {receipt ? (
            <>
              <h2 id="signup-title">Plus qu'une étape avant de valider votre réservation</h2>
              <p>
                Un email de validation vient de vous être envoyé pour confirmer votre réservation de{' '}
                {receipt.seats} place{receipt.seats > 1 ? 's' : ''} pour le{' '}
                {formatLongDate(receipt.serviceDate)}. Le lien est valable 2 heures.
              </p>
              <button className="secondary-button" type="button" onClick={startAnotherReservation}>
                Faire une autre réservation
              </button>
            </>
          ) : duplicateReservation ? (
            <>
              <h2 id="signup-title">Une réservation existe déjà avec cet email</h2>
              <p>
                Une réservation a déjà été faite avec {form.email.trim().toLowerCase()}. Vous pouvez
                recevoir à nouveau le récapitulatif par email.
              </p>
              {duplicateReservation.reservation && (
                <p>
                  {duplicateReservation.reservation.seats} place
                  {duplicateReservation.reservation.seats > 1 ? 's' : ''} pour le{' '}
                  {formatLongDate(duplicateReservation.reservation.serviceDate)}.
                </p>
              )}
              {resendSummaryMessage && (
                <p className="reservation-panel-feedback">{resendSummaryMessage}</p>
              )}
              {errors.form && <p className="reservation-panel-error">{errors.form}</p>}
              <div className="reservation-message-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={handleResendSummary}
                  disabled={resendingSummary}
                >
                  {resendingSummary ? 'Envoi...' : 'Renvoyer le récapitulatif'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setDuplicateReservation(null);
                    setResendSummaryMessage('');
                    setErrors({});
                  }}
                >
                  Modifier l'email
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="panel-heading compact-heading">
                <div>
                  <h2 className="reservation-title" id="signup-title">
                    <span className="reservation-title-text">Réservations</span>
                  </h2>
                  <p className="menu-summary">
                    Menu de saison 28€
                    <br />
                    <span className="menu-summary-details">
                      2 amuse-bouche, 2 entrées, 1 plat, 1 dessert
                      <br />
                      Règlement sur place
                    </span>
                  </p>
                </div>
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
                <label className="field">
                  <span>Nom complet</span>
                  <input
                    value={form.lastName}
                    onChange={(event) => updateField('lastName', event.target.value)}
                    placeholder="Votre nom complet"
                    autoComplete="name"
                    aria-invalid={Boolean(errors.lastName)}
                  />
                  {errors.lastName && <small>{errors.lastName}</small>}
                </label>

                <label className="field">
                  <span>Email</span>
                  <input
                    value={form.email}
                    onChange={(event) => updateField('email', event.target.value)}
                    placeholder="vous@email.fr"
                    type="email"
                    autoComplete="email"
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

                {errors.form && <div className="alert error-alert field-full">{errors.form}</div>}

                <button
                  className="primary-button field-full signup-submit-button"
                  type="submit"
                  disabled={submitting || loading}
                >
                  <CheckCircle2 size={18} />
                  <span>{submitting ? 'Enregistrement...' : 'Valider ma réservation'}</span>
                </button>
              </form>
            </>
          )}
        </section>

        <section className="location-panel" aria-label="Lieu">
          <div className="partner-logos">
            <div className="partner-location">
              <img src="/microwinnerie.png" alt="La Microwinnerie" />
              <address>
                87 Quai des Queyries
                <br />
                33100 Bordeaux
              </address>
            </div>
            <img src="/darwin.png" alt="Darwin" />
          </div>
        </section>
      </div>
    </main>
    </>
  );
}

function ValidationPage() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    async function validateToken() {
      const token = new URLSearchParams(window.location.search).get('token') || '';

      if (!token) {
        setResult({
          status: 'invalid',
          message: 'Lien de validation invalide.',
        });
        setLoading(false);
        return;
      }

      try {
        const validationResult = await confirmReservation(token);
        setResult(validationResult);
      } catch (validationError) {
        setError(validationError.message);
      } finally {
        setLoading(false);
      }
    }

    validateToken();
  }, []);

  if (!isSupabaseConfigured) {
    return <ConfigNotice mode="signup" />;
  }

  const status = result?.status;
  const isSuccess = status === 'confirmed' || status === 'already_confirmed';
  const isExpired = status === 'expired';
  const title = loading
    ? 'Validation en cours'
    : isSuccess
      ? 'Inscription confirmée'
      : isExpired
        ? 'Lien expiré'
        : 'Validation impossible';

  return (
    <main className="center-shell">
      <div className="validation-page-content">
        <img className="validation-logo" src="/zuru-logo-v2.svg" alt="Zuru Zuru Supper Club" />
        <section className="setup-panel validation-panel">
          {loading ? (
            <RefreshCw size={34} aria-hidden="true" />
          ) : !isSuccess ? (
            <XCircle size={34} aria-hidden="true" />
          ) : null}
          <h1>{title}</h1>
          {loading ? (
            <p>Nous confirmons votre inscription...</p>
          ) : error ? (
            <p>{error}</p>
          ) : (
            <p>
              {result?.message ||
                "Nous n'avons pas pu valider cette inscription. Merci de refaire une inscription."}
            </p>
          )}
          {result?.reservation && (
            <div className="validation-summary">
              <strong>
                {result.reservation.seats} place{result.reservation.seats > 1 ? 's' : ''}
              </strong>
              <span>{formatLongDate(result.reservation.serviceDate)}</span>
            </div>
          )}
          {(isExpired || status === 'invalid') && (
            <a className="primary-button" href="/inscription">
              Refaire une inscription
            </a>
          )}
        </section>
      </div>
    </main>
  );
}

function CancellationPage() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') || '', []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    async function loadCancellation() {
      if (!token) {
        setResult({
          status: 'invalid',
          message: "Lien d'annulation invalide.",
        });
        setLoading(false);
        return;
      }

      try {
        const cancellationResult = await previewReservationCancellation(token);
        setResult(cancellationResult);
      } catch (cancellationError) {
        setError(cancellationError.message);
      } finally {
        setLoading(false);
      }
    }

    loadCancellation();
  }, [token]);

  async function handleCancelReservation() {
    if (!token || cancelling) {
      return;
    }

    setCancelling(true);
    setError('');

    try {
      const cancellationResult = await cancelReservation(token);
      setResult(cancellationResult);
    } catch (cancellationError) {
      setError(cancellationError.message);
    } finally {
      setCancelling(false);
    }
  }

  if (!isSupabaseConfigured) {
    return <ConfigNotice mode="signup" />;
  }

  const status = result?.status;
  const isReady = status === 'ready';
  const isCancelled = status === 'cancelled';
  const isInvalid = status === 'invalid';
  const title = loading
    ? 'Chargement en cours'
    : isCancelled
      ? 'Réservation annulée'
      : isReady
        ? 'Annuler ma réservation'
        : 'Annulation impossible';

  return (
    <main className="center-shell">
      <div className="validation-page-content">
        <img className="validation-logo" src="/zuru-logo-v2.svg" alt="Zuru Zuru Supper Club" />
        <section className="setup-panel validation-panel">
          {loading ? (
            <RefreshCw size={34} aria-hidden="true" />
          ) : !isReady && !isCancelled ? (
            <XCircle size={34} aria-hidden="true" />
          ) : null}
          <h1>{title}</h1>
          {loading ? (
            <p>Nous récupérons votre réservation...</p>
          ) : error ? (
            <p>{error}</p>
          ) : (
            <p>
              {result?.message ||
                "Nous n'avons pas pu retrouver cette réservation. Merci de refaire une inscription."}
            </p>
          )}
          {result?.reservation && (
            <div className="validation-summary">
              <strong>
                {result.reservation.seats} place{result.reservation.seats > 1 ? 's' : ''}
              </strong>
              <span>{formatLongDate(result.reservation.serviceDate)}</span>
            </div>
          )}
          {isReady && (
            <div className="validation-actions">
              <button
                className="primary-button"
                type="button"
                onClick={handleCancelReservation}
                disabled={cancelling}
              >
                {cancelling ? 'Annulation...' : 'Annuler ma réservation'}
              </button>
              <a className="secondary-button" href="/inscription">
                Garder ma réservation
              </a>
            </div>
          )}
          {isCancelled && (
            <a className="primary-button" href="/inscription">
              Faire une autre réservation
            </a>
          )}
          {isInvalid && (
            <a className="primary-button" href="/inscription">
              Refaire une inscription
            </a>
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
      <main className="center-shell admin-shell admin-auth-shell">
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
    <main className="center-shell admin-shell admin-auth-shell">
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
  const [statusFilter, setStatusFilter] = useState('tous');
  const [dateFilter, setDateFilter] = useState(NEXT_SERVICE_DATE);
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
      .filter(
        (reservation) =>
          reservation.date === date &&
          reservation.id !== exceptId &&
          isReservationHoldingSeats(reservation),
      )
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
          [reservation.firstName, reservation.lastName, reservation.email, reservation.phone]
            .join(' ')
            .toLocaleLowerCase('fr-FR')
            .includes(normalizedQuery);
        const matchesDate = !dateFilter || reservation.date === dateFilter;
        const matchesStatus =
          statusFilter === 'tous' || reservation.effectiveValidationStatus === statusFilter;

        return matchesQuery && matchesDate && matchesStatus;
      })
      .sort((a, b) => `${a.date}-${a.createdAt}`.localeCompare(`${b.date}-${b.createdAt}`));
  }, [dateFilter, query, reservations, statusFilter]);

  const stats = useMemo(() => {
    const visibleReservations = reservations.filter((reservation) => reservation.date === dateFilter);
    const activeReservations = visibleReservations.filter(isReservationHoldingSeats);
    const bookedSeats = activeReservations.reduce(
      (total, reservation) => total + reservation.seats,
      0,
    );
    const pendingCount = visibleReservations.filter(
      (reservation) => reservation.effectiveValidationStatus === 'pending',
    ).length;

    return {
      reservationCount: visibleReservations.length,
      bookedSeats,
      pendingCount,
      remainingSeats: Math.max(0, MAX_SEATS - bookedSeats),
    };
  }, [dateFilter, reservations]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  }

  function resetForm() {
    setEditingId(null);
    setForm({ ...emptyAdminForm, date: NEXT_SERVICE_DATE });
    setFormErrors({});
  }

  function validateAdminForm() {
    const nextErrors = {};
    const seats = Number(form.seats);

    if (!form.date || !isThursday(form.date)) {
      nextErrors.date = 'Choisis un jeudi';
    }

    if (!form.lastName.trim()) {
      nextErrors.lastName = 'Nom complet requis';
    }

    if (!emailPattern.test(form.email.trim())) {
      nextErrors.email = 'Email invalide';
    }

    if (!form.phone.trim()) {
      nextErrors.phone = 'Téléphone requis';
    } else if (!isFrenchPhoneNumber(form.phone)) {
      nextErrors.phone = 'Numéro de téléphone français invalide';
    }

    if (!seats || seats < 1) {
      nextErrors.seats = 'Nombre invalide';
    } else if (seats > availableSeatsForForm) {
      nextErrors.seats = `Il reste ${availableSeatsForForm} place${
        availableSeatsForForm > 1 ? 's' : ''
      }`;
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
      firstName: '',
      lastName: form.lastName,
      email: form.email,
      phone: form.phone,
      seats: Number(form.seats),
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
    const reservationName = [reservation.firstName, reservation.lastName].filter(Boolean).join(' ');
    setForm({
      date: reservation.date,
      firstName: '',
      lastName: reservationName,
      email: reservation.email,
      phone: reservation.phone,
      seats: reservation.seats,
    });
    setFormErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    <main className="app-shell admin-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Dashboard admin</p>
          <h1>Inscriptions du jeudi</h1>
        </div>
        <div className="admin-actions">
          <a className="secondary-button" href="/inscription">
            Retour au site
          </a>
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
            <span>Places bloquées</span>
            <strong>{stats.bookedSeats}</strong>
          </div>
        </article>
        <article className="metric metric-amber">
          <Mail size={22} aria-hidden="true" />
          <div>
            <span>En attente</span>
            <strong>{stats.pendingCount}</strong>
          </div>
        </article>
        <article className="metric metric-ink">
          <CalendarDays size={22} aria-hidden="true" />
          <div>
            <span>Places restantes</span>
            <strong>{stats.remainingSeats}</strong>
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
            <div className="field field-full">
              <span>Date</span>
              <div className="fixed-date-display" aria-invalid={Boolean(formErrors.date)}>
                <CalendarDays size={20} aria-hidden="true" />
                <div>
                  <strong>{formatLongDate(form.date)}</strong>
                  <small>
                    {availableSeatsForForm} place{availableSeatsForForm > 1 ? 's' : ''} disponible
                    {availableSeatsForForm > 1 ? 's' : ''}
                  </small>
                </div>
              </div>
              {formErrors.date && <small>{formErrors.date}</small>}
            </div>

            <label className="field">
              <span>Nom complet</span>
              <input
                value={form.lastName}
                onChange={(event) => updateForm('lastName', event.target.value)}
                autoComplete="name"
                aria-invalid={Boolean(formErrors.lastName)}
              />
              {formErrors.lastName && <small>{formErrors.lastName}</small>}
            </label>

            <label className="field">
              <span>Email</span>
              <input
                value={form.email}
                onChange={(event) => updateForm('email', event.target.value)}
                type="email"
                autoComplete="email"
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
              <span>Statut</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                {validationStatusOptions.map((option) => (
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
                const reservationName =
                  [reservation.firstName, reservation.lastName].filter(Boolean).join(' ') ||
                  reservation.email;
                const status = reservation.effectiveValidationStatus;

                return (
                  <article className="reservation-card" key={reservation.id}>
                    <div className="reservation-time">
                      <CalendarDays size={18} aria-hidden="true" />
                      <strong>{reservation.seats}</strong>
                      <span>place{reservation.seats > 1 ? 's' : ''}</span>
                    </div>

                    <div className="reservation-main">
                      <div className="reservation-title-row">
                        <h3>{reservationName}</h3>
                        <span className={`status-pill status-${status}`}>
                          {getValidationStatusLabel(status)}
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
                        {status === 'pending' && reservation.validationExpiresAt && (
                          <span>
                            <CalendarDays size={15} aria-hidden="true" />
                            Expire le {formatDateTime(reservation.validationExpiresAt)}
                          </span>
                        )}
                        {status === 'confirmed' && reservation.confirmedAt && (
                          <span>
                            <CheckCircle2 size={15} aria-hidden="true" />
                            Confirmée le {formatDateTime(reservation.confirmedAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="reservation-actions">
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => editReservation(reservation)}
                        aria-label={`Modifier ${reservationName}`}
                      >
                        <Edit3 size={18} />
                      </button>
                      <button
                        className="icon-button danger"
                        type="button"
                        onClick={() => removeReservation(reservation.id)}
                        aria-label={`Supprimer ${reservationName}`}
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
