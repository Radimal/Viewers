import React from 'react';
import type { ConsultCoverage } from '../utils/consultCoverage';

// Radimal amber for "covered by the consultation": the banner and the
// outline on covered series thumbnails.
export const CONSULT_AMBER_RING = 'ring-2 ring-[#f59e0b]';

function formatConsultTime(completedAt: number): string {
  const completed = new Date(completedAt);
  const sameDay = completed.toDateString() === new Date().toDateString();
  return completed.toLocaleString(undefined, {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Consultation 12:12 PM covers 4 of 7 series · 3 received after consultation" */
function ConsultCoverageBanner({ coverage }: { coverage: ConsultCoverage }) {
  const { completedAt, covered, total, after } = coverage;
  return (
    <div
      data-cy="consult-coverage-banner"
      className="mx-2 my-1 rounded border border-[#f59e0b] bg-[#f59e0b]/10 px-2 py-1 text-[12px] leading-4 text-[#f59e0b]"
    >
      Consultation {formatConsultTime(completedAt)} covers {covered.size} of {total} series ·{' '}
      {after} received after consultation
    </div>
  );
}

export default ConsultCoverageBanner;
