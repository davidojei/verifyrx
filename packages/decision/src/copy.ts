import type { NoteCode, SignCode } from './photo';
import type { Reason, ResultState } from './types';

export const DISCLAIMER =
  'VerifyRx is a screening aid, not a medical or regulatory decision. ' +
  'A result only tells you what our records show about a code. ' +
  'If you are unsure about a medicine, ask a pharmacist.';

export const STATE_COPY: Record<ResultState, { headline: string; explanation: string; advice: string }> = {
  VERIFIED: {
    headline: 'Matches our records',
    explanation:
      'This code matches a record in our reference database and nothing looked unusual. ' +
      'This is a screening result only, not a confirmation of quality.',
    advice:
      'Check that the product name, batch number and expiry date on the pack match what is shown here. ' +
      'If anything looks different, ask a pharmacist.',
  },
  SUSPICIOUS: {
    headline: 'Something does not look right',
    explanation: 'This code is in our records, but we found one or more warning signs (listed below).',
    advice: 'Ask a pharmacist to check this medicine before you use it. You can also report it.',
  },
  CANT_CONFIRM: {
    headline: 'We cannot confirm this',
    explanation:
      'We could not find this code in our records. That does not mean the medicine is fake: ' +
      'our database may simply not include it yet.',
    advice: 'Ask a pharmacist to check it. You can also report it so our team can look into it.',
  },
};

export const REASON_COPY: Record<Reason, string> = {
  CODE_NOT_FOUND: 'This code is not in our records.',
  RECALLED: 'This batch is marked as recalled in our records.',
  EXPIRED: 'The expiry date for this batch has passed.',
  REPORTED_FAKE: 'This code was reported as fake and our team confirmed the report.',
  REPORTED_BY_USERS: 'Several people have reported a problem with this code. The reports have not been reviewed yet.',
  MANY_DEVICES: 'This code has been scanned on more phones than expected, which can happen when a code has been copied.',
  MANY_LOCATIONS: 'This code has been scanned in several different areas, which can happen when a code has been copied.',
  HIGH_SCAN_COUNT: 'This code has been scanned more times than we would normally expect for one pack.',
};
export const OFFLINE_NOTE =
  'You are offline, so this result uses data saved on your phone. It may be out of date and does not include your scan.';
export const NO_OFFLINE_DATA_NOTE =
  'There is no saved data on this phone yet. Connect to the internet once so VerifyRx can download it.';
export const RATE_LIMITED_NOTE =
  'You have checked a lot of codes in a short time. Please wait a minute and try again.';
export const GENERIC_ERROR_NOTE = 'Something went wrong. Please try again.';
export const UNREADABLE_CODE_NOTE = 'That code could not be read. Please try again.';
export const REPORT_SENT_NOTE =
  'Thank you. Your report was sent to our team for review. A report on its own does not confirm that a medicine is fake.';
export const REPORT_QUEUED_NOTE =
  'Your report is saved on this phone. It will be sent automatically once you are back online.';
export const REPORT_RATE_LIMITED_NOTE =
  'You have sent several reports recently. Yours is saved and will be sent a little later.';
export const REPORT_QUEUE_FULL_NOTE =
  'Too many reports are waiting to send. Please connect to the internet and try again.';
export const REPORT_NEEDS_DETAIL_NOTE = 'Add a code, a product name or at least one photo.';
export const REPORT_PRIVACY_NOTE =
  'Photos and notes are sent to our team. Please avoid including people, faces or personal details in photos.';
export const SIGNS_HEADING = 'Signs we noticed';

export const PHOTO_DISCLAIMER =
  'Photo checks are a screening aid only. They can miss problems and can also flag packs that are fine.';

export const SIGN_COPY: Record<SignCode, string> = {
  REG_NO_MISMATCH: 'The registration number printed on the pack belongs to a different product in our records.',
  PACK_EXPIRED: 'The expiry date printed on the pack has passed.',
  MANDATORY_FIELD_MISSING:
    'A detail that should be printed on the pack, such as the batch number, expiry date or registration number, could not be found.',
  BATCH_FORMAT_MISMATCH: 'The batch number is not written in the format we expect for this manufacturer.',
  PACK_CONTRADICTS_RECORD: 'The batch or expiry date on the pack does not match our record for the code you scanned.',
  VISUAL_DIFFERENCE: 'Something about the printing or design looked different from our reference photos.',
};

export const NOTE_COPY: Record<NoteCode, string> = {
  PHOTO_NO_SIGNS_NOT_PROOF:
    'We did not notice anything unusual in the photos. A photo cannot confirm that a medicine is genuine.',
  PHOTO_INCONCLUSIVE: 'The photos were not clear enough to check, so they did not change the result.',
  ASK_PHARMACIST: 'Ask a pharmacist to check this medicine before you use it.',
};