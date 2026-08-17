import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Copy,
  Edit3,
  Instagram,
  LogIn,
  LogOut,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UsersRound,
  XCircle,
} from 'lucide-react';
import { MAX_SEATS, PRICE_PER_SEAT_CENTS, PUBLIC_PAGE_MODE } from './lib/config';
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
  fetchReservationPaymentLink,
  fetchReservations,
  generateReservationPaymentLink,
  getValidationStatusLabel,
  getPaymentStatusLabel,
  isReservationHoldingSeats,
  markReservationRefunded,
  manageSupperClubCampaign,
  paymentStatusOptions,
  previewReservationCancellation,
  reconcileHelloAssoPayment,
  resendReservationSummary,
  startReservationPayment,
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

function formatMoneyCents(value) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(
    Number(value || 0) / 100,
  );
}

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
  if (window.location.pathname.startsWith('/paiement')) return 'payment';
  if (window.location.pathname.startsWith('/reglement')) return 'paymentLink';
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
  if (route === 'payment') return <PaymentPage />;
  if (route === 'paymentLink') return <ReservationPaymentPage />;
  return PUBLIC_PAGE_MODE === 'waiting' ? <WaitingPage /> : <SignupPage />;
}

function ReservationPaymentPage() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const token = new URLSearchParams(window.location.search).get('token') || '';

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    async function loadPaymentLink() {
      if (!token) {
        setError('Lien de paiement invalide.');
        setLoading(false);
        return;
      }
      try {
        const nextResult = await fetchReservationPaymentLink({ token });
        if (!cancelled) setResult(nextResult);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPaymentLink();
    return () => { cancelled = true; };
  }, [token]);

  async function handlePayment() {
    setPaying(true);
    setError('');
    try {
      const checkout = await startReservationPayment({ token });
      if (checkout?.status === 'paid') {
        setResult(checkout);
        return;
      }
      if (!checkout?.checkoutUrl) throw new Error('Le paiement HelloAsso est indisponible.');
      window.location.assign(checkout.checkoutUrl);
    } catch (paymentError) {
      setError(paymentError.message);
      setPaying(false);
    }
  }

  if (!isSupabaseConfigured) return <ConfigNotice mode="signup" />;
  const reservation = result?.reservation;
  const isPaid = ['paid', 'refund_pending', 'refunded'].includes(result?.status);

  return (
    <main className="center-shell payment-link-shell">
      <div className="validation-page-content payment-link-content">
        <img className="validation-logo" src="/zuru-logo-v2.svg" alt="Zuru Zuru Supper Club" />
        <section className="setup-panel validation-panel payment-link-panel">
          {loading ? (
            <>
              <RefreshCw className="spin-icon" size={34} aria-hidden="true" />
              <h1>Chargement du règlement</h1>
              <p>Nous retrouvons votre réservation.</p>
            </>
          ) : error && !reservation ? (
            <>
              <XCircle size={34} aria-hidden="true" />
              <h1>Lien indisponible</h1>
              <p>{error}</p>
            </>
          ) : isPaid ? (
            <>
              <CheckCircle2 size={34} aria-hidden="true" />
              <h1>Réservation déjà réglée</h1>
              <p>Merci, le paiement de cette réservation a bien été enregistré.</p>
            </>
          ) : (
            <>
              <p className="payment-link-eyebrow">Règlement de votre réservation</p>
              <h1>{reservation?.fullName}</h1>
              <div className="payment-link-summary">
                <div>
                  <span>Date du dîner</span>
                  <strong>{reservation && formatLongDate(reservation.serviceDate)}</strong>
                </div>
                <div>
                  <span>Nombre de places</span>
                  <strong>{reservation?.seats} place{reservation?.seats > 1 ? 's' : ''}</strong>
                </div>
                <div className="payment-link-total">
                  <span>Montant total</span>
                  <strong>{formatMoneyCents(reservation?.amountCents)}</strong>
                </div>
              </div>
              {error && <div className="alert error-alert">{error}</div>}
              <button className="primary-button payment-link-button" type="button" onClick={handlePayment} disabled={paying}>
                <span>{paying ? 'Préparation du paiement...' : `Payer ${formatMoneyCents(reservation?.amountCents)}`}</span>
              </button>
              <p className="payment-link-note">Paiement sécurisé sur la plateforme HelloAsso.</p>
            </>
          )}
        </section>
      </div>
    </main>
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
VITE_SUPABASE_ANON_KEY=...`}</pre>
        <span>{mode === 'admin' ? 'Le dashboard sera disponible après connexion admin.' : 'La page publique sera active après connexion à la base.'}</span>
      </section>
    </main>
  );
}

function WaitingPage() {
  return (
    <main className="public-shell public-shell-transition waiting-page is-visible">
      <section className="public-header">
        <div className="public-title-block">
          <div className="brand-date-lockup">
            <img className="zuru-logo" src="/zuru-logo-v2.svg" alt="Zuru Zuru Supper Club" />
            <span className="brand-date-separator" aria-hidden="true" />
            <span className="event-date" aria-label="Prochain dîner bientôt annoncé">
              SOON
            </span>
          </div>
          <p className="lead">
            Une table, des produits locaux, des ingrédients de saison, des vins choisis avec soin,
            des conversations qui rapprochent.
          </p>
          <p className="menu-summary waiting-menu-summary">
            <strong>Menu de saison 32€</strong>
            <br />
            <strong className="menu-summary-details">
              2 amuse-bouche, 2 entrées, 1 plat, 1 dessert
            </strong>
          </p>
          <a
            className="waiting-instagram-link"
            href="https://www.instagram.com/zuruzuru_supperclub/"
            target="_blank"
            rel="noreferrer"
          >
            <Instagram size={19} aria-hidden="true" />
            <span>@zuruzuru_supperclub</span>
          </a>
        </div>
      </section>

      <div className="public-grid">
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
  const paymentTotalCents = requestedSeats * PRICE_PER_SEAT_CENTS;

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
      if (!reservation?.checkoutUrl) {
        throw new Error('Le lien de paiement HelloAsso est indisponible. Merci de réessayer.');
      }
      window.location.assign(reservation.checkoutUrl);
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
          <p className="menu-summary">
            Menu de saison 28€
            <br />
            <span className="menu-summary-details">
              2 amuse-bouche, 2 entrées, 1 plat, 1 dessert
            </span>
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
                  <p className="menu-timing">
                    <span>Apéritif à partir de 18:00</span>
                    <span className="menu-timing-separator" aria-hidden="true">
                      /
                    </span>
                    <span>Début du dîner à 20:30</span>
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

                <div className="payment-summary field-full">
                  <CreditCard size={20} aria-hidden="true" />
                  <span>Total à payer</span>
                  <strong>{formatMoneyCents(paymentTotalCents)}</strong>
                </div>

                {errors.form && <div className="alert error-alert field-full">{errors.form}</div>}

                <button
                  className="primary-button field-full signup-submit-button"
                  type="submit"
                  disabled={submitting || loading}
                >
                  <CreditCard size={18} />
                  <span>{submitting ? 'Préparation du paiement...' : `Payer ${formatMoneyCents(paymentTotalCents)}`}</span>
                </button>

                <p className="signup-cancellation-note field-full">
                  Nos menus sont préparés sur mesure à partir de produits frais et locaux. Les
                  annulations sont possibles uniquement jusqu’à 48 heures avant le dîner.
                </p>
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

function PaymentPage() {
  const [result, setResult] = useState({ status: 'checking' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || '';
    const checkoutIntentId = params.get('checkoutIntentId') || '';
    const returnedWithError = params.get('type') === 'error';

    async function checkPayment() {
      if (!token) {
        setResult({ status: 'failed', message: 'Retour de paiement invalide.' });
        return;
      }
      for (let attempt = 0; attempt < 7 && !cancelled; attempt += 1) {
        try {
          const nextResult = await reconcileHelloAssoPayment({ token, checkoutIntentId });
          if (cancelled) return;
          setResult(nextResult || { status: 'pending' });
          if (nextResult?.status !== 'pending') return;
          if (returnedWithError) {
            setResult({ status: 'failed', message: 'HelloAsso signale une erreur et aucun paiement confirmé n’a été trouvé.' });
            return;
          }
        } catch (paymentError) {
          if (!cancelled) setError(paymentError.message);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
      }
      if (!cancelled) setResult({ status: 'delayed' });
    }
    checkPayment();
    return () => { cancelled = true; };
  }, []);

  if (!isSupabaseConfigured) return <ConfigNotice mode="signup" />;
  const status = result?.status;
  const paid = status === 'paid';
  const pending = status === 'checking' || status === 'pending';
  const conflict = status === 'conflict';
  const title = paid
    ? 'Paiement confirmé'
    : pending
      ? 'Confirmation du paiement'
      : conflict
        ? 'Paiement à vérifier'
        : status === 'delayed'
          ? 'Confirmation en attente'
        : 'Paiement non confirmé';

  return (
    <main className="center-shell">
      <div className="validation-page-content">
        <img className="validation-logo" src="/zuru-logo-v2.svg" alt="Zuru Zuru Supper Club" />
        <section className="setup-panel validation-panel">
          {paid ? <CheckCircle2 size={34} aria-hidden="true" /> : pending ? <RefreshCw size={34} aria-hidden="true" /> : <XCircle size={34} aria-hidden="true" />}
          <h1>{title}</h1>
          {error ? (
            <p>{error}</p>
          ) : paid ? (
            <p>Votre réservation est confirmée. Un email récapitulatif vient de vous être envoyé.</p>
          ) : pending ? (
            <p>Nous vérifions la confirmation auprès de HelloAsso. Cette opération peut prendre quelques secondes.</p>
          ) : conflict ? (
            <p>Votre paiement a été reçu mais nécessite une vérification. L’équipe a été prévenue et vous contactera.</p>
          ) : status === 'delayed' ? (
            <p>La confirmation prend plus de temps que prévu. Ne payez pas une seconde fois : vous recevrez un email dès que HelloAsso aura confirmé le paiement.</p>
          ) : (
            <p>{result?.message || 'Le paiement n’a pas été confirmé. Vous pouvez reprendre votre réservation.'}</p>
          )}
          {result?.reservation && (
            <div className="validation-summary">
              <strong>{result.reservation.seats} place{result.reservation.seats > 1 ? 's' : ''} · {formatMoneyCents(result.reservation.amountCents)}</strong>
              <span>{formatLongDate(result.reservation.serviceDate)}</span>
            </div>
          )}
          {!pending && <a className="primary-button" href="/inscription">{paid || status === 'delayed' || conflict ? 'Retour au site' : 'Reprendre ma réservation'}</a>}
        </section>
      </div>
    </main>
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
  const isCutoff = status === 'cutoff';
  const title = loading
    ? 'Chargement en cours'
    : isCancelled
      ? 'Réservation annulée'
      : isReady
        ? 'Annuler ma réservation'
        : isCutoff
          ? 'Délai d’annulation dépassé'
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
              <p className="cancellation-warning">
                Nos menus sont préparés sur mesure à partir de produits frais et locaux. Les
                annulations sont possibles uniquement jusqu’à 48 heures avant le dîner.
              </p>
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
          {isCutoff && (
            <a className="primary-button" href="/inscription">
              Retour au site
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

function CampaignGroup({ title, description, recipients, action, onSendOne, canSend, excluded = false }) {
  return (
    <article className={`campaign-group${excluded ? ' is-excluded' : ''}`}>
      <header>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <strong>{recipients.length}</strong>
      </header>
      <div className="campaign-recipient-list">
        {recipients.length === 0 ? (
          <p className="campaign-empty">Aucun destinataire</p>
        ) : recipients.map((recipient) => (
          <div className="campaign-recipient" key={recipient.reservationId}>
            <div>
              <strong>{recipient.fullName}</strong>
              <span>{recipient.email} · {recipient.seats} place{recipient.seats > 1 ? 's' : ''}</span>
              {excluded && <small>{recipient.reason}</small>}
              {recipient.delivery?.status === 'sent' && (
                <small className="campaign-delivery-success">Envoyé le {formatDateTime(recipient.delivery.sentAt)}</small>
              )}
              {recipient.delivery?.status === 'failed' && (
                <small className="campaign-delivery-error">Échec : {recipient.delivery.error}</small>
              )}
              {recipient.delivery?.status === 'sending' && <small>Envoi en cours…</small>}
            </div>
            {!excluded && recipient.delivery?.status !== 'sending' && (
              <button
                className="secondary-button campaign-resend-button"
                type="button"
                onClick={() => onSendOne(recipient)}
                disabled={Boolean(action) || !canSend}
              >
                {action === recipient.reservationId
                  ? 'Envoi…'
                  : recipient.delivery?.status === 'sent'
                    ? 'Renvoyer'
                    : recipient.delivery?.status === 'failed'
                      ? 'Réessayer'
                      : 'Envoyer'}
              </button>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

function AdminDashboard({ userEmail }) {
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('tous');
  const [paymentFilter, setPaymentFilter] = useState('tous');
  const [dateFilter, setDateFilter] = useState(NEXT_SERVICE_DATE);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyAdminForm);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [paymentLinks, setPaymentLinks] = useState({});
  const [generatingPaymentLinkId, setGeneratingPaymentLinkId] = useState(null);
  const [copiedPaymentLinkId, setCopiedPaymentLinkId] = useState(null);
  const [campaign, setCampaign] = useState(null);
  const [campaignLoading, setCampaignLoading] = useState(true);
  const [campaignAction, setCampaignAction] = useState('');
  const [campaignError, setCampaignError] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [campaignTestsSent, setCampaignTestsSent] = useState(false);
  const [campaignTestResults, setCampaignTestResults] = useState([]);

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

  async function loadCampaignPreview() {
    setCampaignLoading(true);
    setCampaignError('');
    try {
      setCampaign(await manageSupperClubCampaign('preview'));
    } catch (previewError) {
      setCampaignError(previewError.message);
    } finally {
      setCampaignLoading(false);
    }
  }

  useEffect(() => {
    loadCampaignPreview();
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
        const matchesPayment =
          paymentFilter === 'tous' || reservation.paymentStatus === paymentFilter;

        return matchesQuery && matchesDate && matchesStatus && matchesPayment;
      })
      .sort((a, b) => `${a.date}-${a.createdAt}`.localeCompare(`${b.date}-${b.createdAt}`));
  }, [dateFilter, paymentFilter, query, reservations, statusFilter]);

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
    const refundPendingCount = visibleReservations.filter(
      (reservation) => reservation.paymentStatus === 'refund_pending',
    ).length;

    return {
      reservationCount: visibleReservations.length,
      bookedSeats,
      pendingCount,
      refundPendingCount,
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

  async function markRefunded(id) {
    if (!window.confirm('Confirmer que ce paiement a été remboursé dans HelloAsso ?')) return;
    try {
      const updated = await markReservationRefunded(id);
      setReservations((current) => current.map((reservation) => reservation.id === id ? updated : reservation));
    } catch (refundError) {
      setError(refundError.message);
    }
  }

  async function generatePaymentLink(reservation) {
    if (
      reservation.hasPaymentLink &&
      !window.confirm("Créer un nouveau lien ? L’ancien lien ne fonctionnera plus.")
    ) {
      return;
    }

    setGeneratingPaymentLinkId(reservation.id);
    setError('');
    try {
      const generated = await generateReservationPaymentLink(reservation.id);
      setPaymentLinks((current) => ({ ...current, [reservation.id]: generated.paymentUrl }));
      setReservations((current) => current.map((item) => (
        item.id === reservation.id
          ? { ...item, hasPaymentLink: true, paymentLinkCreatedAt: generated.createdAt, paymentAmountCents: generated.amountCents }
          : item
      )));
      try {
        await navigator.clipboard.writeText(generated.paymentUrl);
        setCopiedPaymentLinkId(reservation.id);
        window.setTimeout(() => setCopiedPaymentLinkId((current) => (
          current === reservation.id ? null : current
        )), 2000);
      } catch {
        // The generated URL remains visible and can be copied manually.
      }
    } catch (linkError) {
      setError(linkError.message);
    } finally {
      setGeneratingPaymentLinkId(null);
    }
  }

  async function copyPaymentLink(reservationId) {
    const paymentUrl = paymentLinks[reservationId];
    if (!paymentUrl) return;
    try {
      await navigator.clipboard.writeText(paymentUrl);
      setCopiedPaymentLinkId(reservationId);
      window.setTimeout(() => setCopiedPaymentLinkId((current) => (
        current === reservationId ? null : current
      )), 2000);
    } catch {
      setError('Copie automatique impossible. Sélectionnez le lien puis copiez-le.');
    }
  }

  async function copyOrCreatePaymentLink(reservation) {
    if (paymentLinks[reservation.id]) {
      await copyPaymentLink(reservation.id);
      return;
    }

    await generatePaymentLink(reservation);
  }

  async function sendCampaignTests() {
    setCampaignAction('test');
    setCampaignError('');
    setCampaignMessage('');
    try {
      const result = await manageSupperClubCampaign('test');
      setCampaignTestResults(result.results || []);
      setCampaignTestsSent(Boolean(result.testSent));
      if (result.testSent) {
        setCampaignMessage(`Deux emails tests ont été acceptés par Resend pour ${result.recipient}.`);
      } else {
        setCampaignError(`Seulement ${result.count || 0} email test sur 2 a été accepté par Resend.`);
      }
    } catch (testError) {
      setCampaignError(testError.message);
    } finally {
      setCampaignAction('');
    }
  }

  async function sendCampaign() {
    const pendingCount = [...(campaign?.paid || []), ...(campaign?.unpaid || [])]
      .filter((recipient) => recipient.delivery?.status !== 'sent').length;
    if (!window.confirm(`Envoyer maintenant la campagne à ${pendingCount} destinataire${pendingCount > 1 ? 's' : ''} ?`)) return;

    setCampaignAction('send');
    setCampaignError('');
    setCampaignMessage('');
    try {
      const result = await manageSupperClubCampaign('send', { confirm: true });
      const sentCount = (result.results || []).filter((item) => item.sentAt).length;
      const failedCount = (result.results || []).filter((item) => item.error).length;
      setCampaignMessage(`${sentCount} email${sentCount > 1 ? 's' : ''} envoyé${sentCount > 1 ? 's' : ''}${failedCount ? `, ${failedCount} échec${failedCount > 1 ? 's' : ''}` : ''}.`);
      await loadCampaignPreview();
    } catch (sendError) {
      setCampaignError(sendError.message);
    } finally {
      setCampaignAction('');
    }
  }

  async function sendCampaignEmailToOne(recipient) {
    const verb = recipient.delivery?.status === 'sent' ? 'Renvoyer' : 'Envoyer';
    if (!window.confirm(`${verb} cet email uniquement à ${recipient.email} ?`)) return;
    setCampaignAction(recipient.reservationId);
    setCampaignError('');
    setCampaignMessage('');
    try {
      const response = await manageSupperClubCampaign('send-one', {
        confirm: true,
        reservationId: recipient.reservationId,
      });
      if (response.result?.error) throw new Error(response.result.error);
      setCampaignMessage(`Email envoyé uniquement à ${recipient.email}.`);
      await loadCampaignPreview();
    } catch (resendError) {
      setCampaignError(resendError.message);
    } finally {
      setCampaignAction('');
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
          <CreditCard size={22} aria-hidden="true" />
          <div>
            <span>À rembourser</span>
            <strong>{stats.refundPendingCount}</strong>
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

      <section className="panel campaign-panel" aria-labelledby="campaign-title">
        <div className="panel-heading campaign-heading">
          <div>
            <p className="eyebrow">Email du 16 juillet</p>
            <h2 id="campaign-title">À demain pour notre premier Supper Club !</h2>
          </div>
          <button className="secondary-button" type="button" onClick={loadCampaignPreview} disabled={campaignLoading || Boolean(campaignAction)}>
            <RefreshCw size={17} />
            Actualiser l’aperçu
          </button>
        </div>

        {campaignError && <div className="alert error-alert campaign-alert">{campaignError}</div>}
        {campaignMessage && <div className="alert info-alert campaign-alert">{campaignMessage}</div>}

        {campaignLoading ? (
          <div className="campaign-loading">Vérification des destinataires et des paiements HelloAsso…</div>
        ) : campaign ? (
          <>
            <div className="campaign-groups">
              <CampaignGroup
                title="Déjà payés"
                description="Email sans mention du paiement"
                recipients={campaign.paid}
                action={campaignAction}
                onSendOne={sendCampaignEmailToOne}
                canSend={campaignTestsSent}
              />
              <CampaignGroup
                title="Non payés"
                description="Email avec un nouveau lien individuel de règlement"
                recipients={campaign.unpaid}
                action={campaignAction}
                onSendOne={sendCampaignEmailToOne}
                canSend={campaignTestsSent}
              />
              <CampaignGroup
                title="Exclus"
                description="Aucun email ne sera envoyé"
                recipients={campaign.excluded}
                excluded
              />
            </div>
            {campaign.reconciliationWarnings?.length > 0 && (
              <div className="alert error-alert campaign-alert">
                {campaign.reconciliationWarnings.length} paiement en attente n’a pas pu être revérifié auprès de HelloAsso.
              </div>
            )}
            <div className="campaign-actions">
              <button className="secondary-button" type="button" onClick={sendCampaignTests} disabled={Boolean(campaignAction)}>
                <Mail size={17} />
                {campaignAction === 'test' ? 'Envoi des tests…' : `Envoyer les 2 tests à ${userEmail}`}
              </button>
              <button className="primary-button" type="button" onClick={sendCampaign} disabled={!campaignTestsSent || Boolean(campaignAction)}>
                <Send size={17} />
                {campaignAction === 'send' ? 'Envoi en cours…' : 'Confirmer l’envoi aux invités'}
              </button>
            </div>
            {campaignTestResults.length > 0 && (
              <div className="campaign-test-results" aria-live="polite">
                <strong>Résultat des emails tests</strong>
                {campaignTestResults.map((result) => (
                  <div className={result.accepted ? 'is-success' : 'is-error'} key={result.variant}>
                    <span>{result.label}</span>
                    <span>
                      {result.accepted
                        ? `Resend : ${result.status} · ${result.emailId}`
                        : result.error}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {!campaignTestsSent && <p className="campaign-lock-note">Envoyez et vérifiez d’abord les deux emails tests pour activer l’envoi réel.</p>}
          </>
        ) : null}
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
            <label className="field compact-field">
              <span>Paiement</span>
              <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
                {paymentStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
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
                const financiallyLocked = ['paid', 'refund_pending', 'refunded', 'conflict'].includes(reservation.paymentStatus);

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
                        <span className={`status-pill payment-status-${reservation.paymentStatus}`}>
                          {getPaymentStatusLabel(reservation.paymentStatus)}
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
                        {reservation.paymentAmountCents != null && (
                          <span><CreditCard size={15} aria-hidden="true" />{formatMoneyCents(reservation.paymentAmountCents)}</span>
                        )}
                        {reservation.helloAssoPaymentId && <span>HelloAsso #{reservation.helloAssoPaymentId}</span>}
                        {reservation.paymentConflictReason && <span>{reservation.paymentConflictReason}</span>}
                      </div>
                    </div>

                    <div className="reservation-actions">
                      {status === 'confirmed' && ['manual', 'failed', 'pending'].includes(reservation.paymentStatus) && (
                        <button
                          className="secondary-button payment-copy-admin-button"
                          type="button"
                          onClick={() => copyOrCreatePaymentLink(reservation)}
                          disabled={generatingPaymentLinkId === reservation.id}
                          aria-label={`Copier le lien de paiement de ${reservationName}`}
                        >
                          {copiedPaymentLinkId === reservation.id
                            ? <CheckCircle2 size={16} aria-hidden="true" />
                            : <Copy size={16} aria-hidden="true" />}
                          {generatingPaymentLinkId === reservation.id
                            ? 'Création...'
                            : copiedPaymentLinkId === reservation.id
                              ? 'Copié !'
                              : 'Copier le lien de paiement'}
                        </button>
                      )}
                      {reservation.paymentStatus === 'refund_pending' && (
                        <button className="secondary-button" type="button" onClick={() => markRefunded(reservation.id)}>
                          Marquer remboursé
                        </button>
                      )}
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => editReservation(reservation)}
                        aria-label={`Modifier ${reservationName}`}
                      >
                        <Edit3 size={18} />
                      </button>
                      {!financiallyLocked && <button
                        className="icon-button danger"
                        type="button"
                        onClick={() => removeReservation(reservation.id)}
                        aria-label={`Supprimer ${reservationName}`}
                      >
                        <Trash2 size={18} />
                      </button>}
                    </div>
                    {paymentLinks[reservation.id] && (
                      <div className="reservation-payment-link">
                        <input
                          aria-label={`Lien de paiement de ${reservationName}`}
                          value={paymentLinks[reservation.id]}
                          readOnly
                          onFocus={(event) => event.currentTarget.select()}
                        />
                        <span>
                          {copiedPaymentLinkId === reservation.id ? 'Lien copié. ' : 'Lien créé. '}
                          Envoyez-le à la personne concernée.
                        </span>
                      </div>
                    )}
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
