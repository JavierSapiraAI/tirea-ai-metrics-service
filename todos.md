* **diagnostico** . Exact is exact matching (=) while soft allows for slightly different phrasing. This is relevant when certain words are not exactly extracted, when slightly different wordings of the diagnostics appear in different pages or when we extract more than necessary/comma separated diagnostics, etc.
* **medicamentos.** ✓ REMOVED - Medications metric has been removed from the system
* **cie10** . Ambos aplican al código, no tenemos una metrica para la descripcion. Exacto es lo que te imaginas, mientras que prefijo tiene que ver con como están definidos estos codigos, si el comienzo de dos codigos es igual entonces se parecen mas que si es distinto, cuanto mas largo sea el prefijo común, más similares son los códigos. Puedo implementar una metrica para las descripciones tambien.
* Deploy tirea frontend to aws
* Remove old instances of langfuse v2
* enable https/ssl in github deployments for tirea
