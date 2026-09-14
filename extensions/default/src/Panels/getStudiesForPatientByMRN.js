async function getStudiesForPatientByMRN(dataSource, qidoForStudyUID) {
  if (!qidoForStudyUID?.length) {
    return [];
  }

  const mrn = qidoForStudyUID[0].mrn;

  // if not defined or empty, return the original qidoForStudyUID
  if (!mrn) {
    return qidoForStudyUID;
  }

  return dataSource.query.studies.search({
    patientId: mrn,
    disableWildcard: true,
    // Cap the prior-study list (T6). Without this the search inherits the
    // qido.js default of 101; QIDO has no server-side sort, so which 25
    // come back for a >25-study patient is up to the server.
    limit: 25,
    // Radimal: patient-scoped study-browser tabs match on
    // patientName / institution / birthDate — these fields must come
    // back on prior studies too, not just the primary study's query.
    includefield: [
      '00081030', // Study Description
      '00080060', // Modality
      '00080080', // Institution Name
      '00100030', // Patient's Birth Date
      '00101040', // Patient's Address
      '00100010', // Patient's Name
    ],
  });
}

export default getStudiesForPatientByMRN;
