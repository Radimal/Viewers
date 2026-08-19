async function getStudiesForPatientByMRN(dataSource, qidoForStudyUID) {
  if (qidoForStudyUID && qidoForStudyUID.length && qidoForStudyUID[0].mrn) {
    return dataSource.query.studies.search({
      patientId: qidoForStudyUID[0].mrn,
      // Cap the prior-study list. Without this the search inherits the
      // qido.js default of 101; QIDO has no server-side sort, so which 25
      // come back for a >25-study patient is up to the server.
      limit: 25,
      includefield: [
        '00081030', // Study Description
        '00080060', // Modality
        '00080080', // Institution Name
        '00100030', // Patient Birthday
        '00101040', // Patient Address
        '00100010', // Patient Name
        // Add more fields here if you want them in the result
      ].join(','),
      disableWildcard: true,
    });
  }
  console.log('No mrn found for', qidoForStudyUID);
  return qidoForStudyUID;
}

export default getStudiesForPatientByMRN;
