import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const matrixPath = path.join(rootDir, 'public/js/templateFeatures.js');
const editorHtmlPath = path.join(rootDir, 'public/editor.html');
const editorJsPath = path.join(rootDir, 'public/js/editor.js');
const stylesPath = path.join(rootDir, 'public/styles.css');

const { OPTIONAL_FEATURE, TEMPLATE_FEATURES } = await import(pathToFileURL(matrixPath));
const editorHtml = fs.readFileSync(editorHtmlPath, 'utf8');
const editorJs = fs.readFileSync(editorJsPath, 'utf8');
const styles = fs.readFileSync(stylesPath, 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const optionalFeatures = new Set();

for (const features of Object.values(TEMPLATE_FEATURES)) {
  for (const [featureName, value] of Object.entries(features)) {
    if (value === OPTIONAL_FEATURE) {
      optionalFeatures.add(featureName);
    }
  }
}

for (const featureName of optionalFeatures) {
  assert(
    editorHtml.includes(`data-feature-group="${featureName}"`),
    `Editor hat keine Feature-Gruppe für optionales Feature ${featureName}.`
  );
  assert(
    editorHtml.includes(`data-optional-toggle="${featureName}"`),
    `Editor hat keinen Aktivieren-Schalter für optionales Feature ${featureName}.`
  );
  assert(
    editorHtml.includes(`data-feature-setting="${featureName}"`),
    `Editor trennt Detailfelder für optionales Feature ${featureName} nicht von der Aktivierung.`
  );
}

assert(
  editorHtml.includes('data-feature-group="eventBackgroundImage"'),
  'Editor muss das Eventbild als eigenes matrixgesteuertes Feature anzeigen.'
);
assert(
  editorHtml.includes('name="event_apple_background_image_url"')
    && editorHtml.includes('name="event_google_hero_image_url"'),
  'Editor muss Apple-background.png und Google-heroImage getrennt speichern können.'
);
assert(
  editorJs.includes('eventAppleBackgroundImageUrl')
    && editorJs.includes('eventGoogleHeroImageUrl'),
  'Editor muss Apple- und Google-Eventbild-URLs in den Template-Settings speichern.'
);
assert(
  editorHtml.includes('data-feature-group="notifications"') && editorHtml.includes('name="notification_message"'),
  'Editor muss Push-Benachrichtigungen als matrixgesteuertes Feature vorbereiten.'
);
assert(
  editorHtml.includes('data-feature-group="customFields"') && editorHtml.includes('name="custom_fields_text"'),
  'Editor muss Freifelder als matrixgesteuertes Feature vorbereiten.'
);
assert(
  editorJs.includes('notificationsEnabled') && editorJs.includes('customFieldsText'),
  'Editor muss Push- und Freifeld-Settings speichern.'
);
assert(
  editorJs.includes('setWalletNotificationFormDisabled')
    && editorJs.includes('dataset.notificationsDisabled')
    && editorJs.includes('Benachrichtigungen sind für dieses Template deaktiviert')
    && styles.includes('.wallet-notification-form.is-disabled'),
  'Editor muss Wallet-Benachrichtigungen für Templates mit deaktiviertem notifications-Feature sichtbar sperren.'
);
assert(
  editorJs.includes('minTopupCents') && editorJs.includes('maxTopupCents') && editorJs.includes('amountToCents'),
  'Editor muss Guthaben-Aufladegrenzen als Cent-Werte für Edge Functions speichern.'
);

assert(
  editorJs.includes('getTemplateFeatures(templateType)'),
  'Editor muss aktivierbare Zusatzfeatures aus der zentralen Matrix ableiten.'
);
assert(
  editorJs.includes('featureEnabled(draft, featureName)'),
  'Editor muss Detailfelder optionaler Features über featureEnabled(...) anzeigen.'
);
assert(
  editorHtml.includes('optionalFeaturePanel') && editorJs.includes('renderOptionalFeatureToggles'),
  'Editor muss optionale Features in einem separaten matrixgesteuerten Bereich anzeigen.'
);
assert(
  editorJs.includes('optionalFeatureInputNames')
    && editorJs.includes('visibleOptionalFeatureInputNamePrefix')
    && editorJs.includes('data-editor-optional-feature')
    && editorJs.includes('aria-expanded')
    && editorJs.includes('event.stopPropagation()')
    && editorJs.includes('field.disabled = true'),
  'Editor muss sichtbare optionale Feature-Toggles als autoritative Formularfelder verwenden und versteckte Doppel-Toggles deaktivieren.'
);
assert(
  editorJs.includes('optionalFeatureSelections')
    && editorJs.includes('setOptionalFeatureSelection')
    && editorJs.includes('readOptionalFeatureSelection')
    && editorJs.includes('handleOptionalFeatureToggle')
    && editorJs.includes("optionalFeaturePanel?.addEventListener('input', handleOptionalFeatureToggle)"),
  'Editor muss dynamische Clubkarten-Schalter in stabilen Zustand spiegeln, damit Klicks die Detailmenüs öffnen.'
);
assert(
  editorHtml.includes('<option value="club_card">Clubkarte</option>')
    && editorJs.includes('Clubkarten-Funktionen')
    && editorJs.includes('club_features')
    && editorJs.includes('CLUB_FEATURE_DEFAULTS'),
  'Editor muss Clubkarte als eigenes Template mit club_features-Toggles speichern.'
);
assert(
  editorHtml.includes('<option value="event_card" disabled>Eventkarte (in Vorbereitung)</option>')
    && editorJs.includes("lockedEditorTemplateTypes = new Set(['event_card'])")
    && editorJs.includes("lockedEditorFeatures = new Set(['balance'])")
    && editorJs.includes('Guthaben-Funktion (in Vorbereitung)')
    && styles.includes('.optional-feature-toggle.is-locked'),
  'Editor muss Eventkarte und Guthaben sichtbar lassen, aber bis zur Freigabe sperren.'
);
[
  'vip_card',
  'balance_card',
  'cloakroom_card',
  'coupon_card',
  'membership_card'
].forEach((templateType) => {
  assert(
    !editorHtml.includes(`<option value="${templateType}">`),
    `Editor darf zusammengeführte Einzelkarte ${templateType} nicht mehr als neue Dropdown-Option anzeigen.`
  );
});
assert(
  editorJs.includes('retiredEditorTemplateTypes')
    && editorJs.includes('editableTemplateForEditor')
    && editorJs.includes('migratedFromTemplateType'),
  'Editor muss bestehende zusammengeführte Einzelkarten beim Bearbeiten sicher als Clubkarte behandeln.'
);
assert(
  editorJs.includes('Garderoben-Funktion aktivieren')
    && editorJs.includes('Coupon-Funktion aktivieren')
    && editorJs.includes('Mitgliedschafts-Funktion aktivieren'),
  'Editor muss die Clubkarten-Funktionen mit den geforderten Toggle-Labels anzeigen.'
);
assert(
  editorHtml.includes('clubFeatureSpaceWarning')
    && editorHtml.includes('Es sind viele Funktionen aktiv. Auf Wallet-Karten ist der Platz begrenzt.')
    && editorJs.includes('activeOptionalCount < 4'),
  'Editor muss bei vielen aktiven Clubkarten-Funktionen eine Wallet-Platzwarnung anzeigen.'
);
assert(
  styles.includes('[hidden]') && styles.includes('display: none !important'),
  'CSS muss native hidden-Elemente hart ausblenden, damit matrixversteckte Editor-Felder nicht sichtbar bleiben.'
);
assert(
  styles.includes('.optional-feature-toggle')
    && styles.includes('.optional-feature-toggle:has(input:checked)')
    && styles.includes('cursor: pointer'),
  'CSS muss dynamische Clubkarten-Schalter als gut klickbare Umschaltkarten darstellen.'
);
assert(
  editorHtml.includes('data-reward-field') && editorJs.includes('templateSupportsReward'),
  'Editor muss den Belohnungstext nur für passende Template-Typen anzeigen.'
);
assert(
  editorJs.includes("normalizeTemplateType(draft) !== 'club_card'")
    && editorJs.includes('isCloakroomAlwaysVisible'),
  'Editor muss Garderoben-Felder bei Clubkarten nur nach Toggle anzeigen und bestehende Nicht-Club-Templates weiter unterstützen.'
);
assert(
  editorHtml.includes('name="cloakroom_noon_message"')
    && editorHtml.includes('name="cloakroom_location_message"')
    && !editorHtml.includes('name="cloakroom_location_latitude"')
    && !editorHtml.includes('name="cloakroom_location_longitude"')
    && editorHtml.includes('name="event_location"')
    && editorJs.includes('cloakroomNoonMessage')
    && editorJs.includes('cloakroomLocationLatitude: Number.isFinite(businessLatitude)'),
  'Editor muss Standardstandorte aus den Firmendaten übernehmen und nur Eventstandorte editierbar lassen.'
);
assert(
  !editorHtml.includes('cloakroom_dropoff_text')
    && !editorHtml.includes('cloakroom_pickup_text')
    && !editorJs.includes('cloakroomDropoffText')
    && !editorJs.includes('cloakroomPickupText'),
  'Editor darf keine alten Garderoben-Abgabe-/Abholungstexte mehr verwenden.'
);

console.log('Editor-Feature-Bindings folgen der zentralen Matrix.');
