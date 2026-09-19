# Informe real pagado: versión de revisión

El servicio HTTP conserva la ruta POST /v1/x402/audits y la recuperación existente. `mode: live` prepara una única página HTML pública; `fixture` y las solicitudes anteriores mantienen sus respuestas. MCP ofrece únicamente datos de prueba y rechaza solicitudes live. La consulta gratuita live de /v1/audits se limita al entorno local; Vercel y Lambda la rechazan.

## Activación y contrato

Compras live deshabilitadas por defecto. Requieren WEBSITE_INTELLIGENCE_LIVE_ENABLED=true, X402_SETTLEMENT_ENABLED=true, configuración x402 válida y Redis duradero del proveedor. No existe fallback a memoria en producción. La ficha anuncia versión 1.2.0 solo al habilitar live; diferencia schema live 1.1 de fixture 1.0. URL pública HTTP(S), sin cookies ni credenciales, sin ejecutar JavaScript ni recorrer enlaces, máximo tres redirecciones, diez segundos y 2 MB. La puntuación es orientativa.

## Persistencia y recuperación

Identidad estable: requestId, prueba del secreto de recuperación, hash de entrada y hash de ficha. Redis usa creación atómica y comparación de revisión. Estados: preparing, prepared, analysis-failed, attempted, uncertain, settled, delivered. Se conserva el informe y su hash antes de ofrecer el pago. La preparación interrumpida puede retomarse tras una reserva de 30 segundos, únicamente antes del intento de pago.

El marcador attempted se escribe antes de llamar al facilitador. Nunca se libera automáticamente, incluso si se desconoce si se envió el pago. Un resultado incierto requiere evidencia de la transacción original; no autoriza otro cobro. La reconciliación compara la transacción firmada original, activo, destinatario, importe y ledger. Recuperar no vuelve a analizar ni a pagar. Puede aportarse transactionHash a la recuperación para reconciliar una transacción conocida, incluida una transacción con patrocinio de comisiones.

Los registros no tienen borrado automático. El acceso de recuperación del proveedor caduca a las 24 horas; la copia ya guardada en la biblioteca permanece. Redis del proveedor conserva el payload firmado necesario para reconciliar, nunca secretos de la cartera. La prueba pública del secreto no permite leer el informe: se exige el secreto de recuperación o la repetición exacta del payload de pago original.

## Validación reproducible

- npm ci; npm run check: compilación y pruebas unitarias/HTTP, incluidos fallos inducidos y concurrencia con facilitador simulado.
- LIVE_QA_REDIS_URL y LIVE_QA_REDIS_TOKEN seleccionan Redis de prueba; node scripts/test-live-redis.mjs --run-isolated-test verifica ocho solicitudes concurrentes y recuperación desde otro proceso. Usa facilitador simulado y transacción de prueba sin transferencia. Conserva una clave aislada para evidencia.
- La prueba Testnet de esta versión está pendiente. Publicar una revisión y ejecutar el nuevo pago requieren revisión final separada. No reutilizar el marcador del piloto anterior.
