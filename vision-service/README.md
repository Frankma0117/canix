# Fashion Mode — servicio local de visión

Microservicio Python separado del bot de Node - clasifica fotos de prendas usando un modelo
CLIP (zero-shot, gratis, corre en tu propio servidor, sin ninguna API paga). Si no está corriendo,
Fashion Mode simplemente te pide clasificar la prenda a mano - nunca bloquea ni rompe el bot.

## Por qué existe como proceso separado

El bot principal (Node/TypeScript) no tiene forma barata de correr un modelo de visión sin arriesgar
los mismos problemas de binarios nativos que ya tuvo `better-sqlite3` en esta máquina. Python tiene
su propio entorno aislado (venv) que no interfiere con Node en nada - y si este proceso se cae o
se cuelga, el bot sigue funcionando normal, solo sin clasificación automática de fotos.

## Instalación y ejecución rápida

**Windows (probar en local):**

```bash
vision-service\dev.cmd
```

Crea el venv la primera vez (lo reusa después), instala/actualiza dependencias, y arranca con
`--reload` en `http://127.0.0.1:8008`. Es idempotente - podés volver a correrlo sin problema.

**Linux (servidor, Contabo):** ver `deploy/ubuntu-05-setup-vision.sh` y
`deploy/ubuntu-06-setup-vision-service.sh` en la raíz del repo (instalan como servicio systemd que
arranca solo). Paso a paso completo en el README principal, sección "Despliegue en servidor
(Linux)" → Fashion Mode.

**Instalación manual (cualquier plataforma), si preferís no usar los scripts:**

```bash
cd vision-service
python -m venv .venv

# Windows:
.venv\Scripts\activate
# Linux/macOS (el servidor real, Contabo):
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8008
```

La primera vez que arranca, descarga el modelo (`patrickjohncyh/fashion-clip`, ~300-400MB) desde
Hugging Face - necesita internet esa primera vez, después queda cacheado localmente
(`~/.cache/huggingface`).

Si la descarga de `patrickjohncyh/fashion-clip` falla (repo movido, sin internet, etc.), el
servicio cae automáticamente a `openai/clip-vit-base-patch32` (CLIP genérico, mismo tamaño,
funciona razonablemente bien igual para tipos de prenda comunes aunque no esté afinado
específicamente para moda).

Solo escucha en `127.0.0.1` (localhost) - nunca expuesto a internet, solo el bot de Node en la
misma máquina le habla. El bot apunta aquí vía `FASHION_VISION_SERVICE_URL` en `.env` (default
`http://127.0.0.1:8008`, ya coincide con este puerto).

## Uso de RAM — IMPORTANTE, verifica en tu propio servidor

Este servicio no está garantizado para caber cómodo en un servidor de 4GB compartido con el bot de
Node, SQLite, ffmpeg y el modelo de Vosk (transcripción de audio) - la investigación hecha para
elegir este modelo (CLIP, familia MobileCLIP de Apple) sugiere un consumo de CPU en el orden de unos
cientos de MB hasta ~1GB en inferencia, pero eso es una referencia aproximada, NO una garantía para
este modelo específico en tu máquina real.

**Antes de activar `FASHION_MODE_ENABLED=true` en producción:**

1. Arranca el servicio y espera a que cargue el modelo (ver el log "Modelo de visión listo.").
2. Corre `free -h` y anota cuánta RAM quedó libre.
3. Manda un par de fotos reales de prueba (`POST /analyze`) y vuelve a correr `free -h`.
4. Si la RAM libre queda muy ajustada (menos de ~300-500MB libres), considera:
   - Poner `Environment=OMP_NUM_THREADS=1` (ya viene así en `deploy/canix-vision.service`) - reduce
     el pico de memoria de PyTorch a costa de inferencia un poco más lenta.
   - Cambiar `VISION_MODEL_NAME` a algo más liviano (ver `model.py`).
   - Agregar swap al servidor (paliativo, no una solución real de rendimiento).
   - Dejar Fashion Mode sin visión automática (simplemente no arranques este servicio) - el flujo
     de agregar prenda sigue funcionando 100% preguntando los datos a mano.

## Variables de entorno (opcionales)

```bash
VISION_MODEL_NAME=patrickjohncyh/fashion-clip   # o openai/clip-vit-base-patch32
```

## Endpoints

- `GET /health` → `{"ok": true, "model_ready": true}` - para monitoreo básico.
- `POST /analyze` (multipart/form-data):
  - `image`: archivo de imagen.
  - `labels`: JSON con la taxonomía candidata, ej. `[{"group":"type","values":["TOP","BOTTOM",...]}]`
    (el bot de Node la genera fresca en cada llamada desde `src/fashion/taxonomy.ts` - este
    servicio nunca guarda su propia copia de la taxonomía, así nunca se desincronizan).
  - Responde solo con valores tomados de las listas recibidas - nunca inventa una categoría que no
    se le haya pasado (eso es justamente lo que hace "zero-shot classification": elegir el mejor
    texto entre opciones fijas, no generar texto libre).
- `POST /extract-pdf` (multipart/form-data) - soporte de "mandá un PDF con varias fotos de tus
  prendas y las agrego todas de una" (ver `pdf_extract.py` y
  `src/fashion/flows/add-garment-pdf.flow.ts` del lado Node):
  - `file`: el PDF.
  - `max_images` (opcional, default 15): tope de imágenes a devolver.
  - Responde `{"images": ["<jpeg en base64>", ...], "totalFound": N}` - `totalFound` es el conteo
    ANTES del tope, así el bot puede avisar "el PDF tenía N fotos, procesé las primeras M".
  - Extrae las imágenes rasterizadas embebidas en el PDF (vía PyMuPDF) - NO renderiza páginas
    completas, así que solo encuentra fotos que ya están embebidas como imagen dentro del PDF (el
    caso normal si armaste el PDF pegando fotos). Descarta duplicados exactos (un logo/fondo
    repetido en cada página) y cualquier imagen menor a 150px de ancho o alto (íconos/logos, no
    prendas). No usa el modelo CLIP - es solo extracción, la clasificación de cada foto ocurre
    después, una por una, con el `/analyze` de arriba.
  - `PyMuPDF` (el paquete `fitz`) es liviano - no necesita `torch`/`transformers`, su uso de RAM es
    puntual mientras procesa un PDF, no un proceso residente como el modelo CLIP.
