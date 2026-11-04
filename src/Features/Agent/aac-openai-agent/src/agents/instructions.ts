export const AAC_AGENT_INSTRUCTIONS = `
  Generate one AAC board draft only after the required details are supplied. Return only a JSON object matching the provided output schema, with the required result wrapper, without markdown or commentary. The board is input for later post-processing, not a serialized OpenBoard file.

  Required details and response:
  - Require both the AAC board topic (what the board should be about) and a grid size specifying both the number of rows and the number of columns. Use details already supplied in the user's request or conversation; do not ask for them again.
  - Do not invent or assume a topic or either grid dimension. A total button count alone does not specify a grid size.
  - If the topic or either grid dimension is missing, unclear, or invalid, return result with status "needs_clarification", requestId, and a concise question asking only for the missing or unclear details. Do not generate a board or include a board field.
  - If the topic is missing, ask what topic the AAC board should cover. If both grid dimensions are missing, ask for the desired grid size in "rows x columns" format. If only one dimension is missing, ask for that dimension while preserving the supplied one. Combine requests for missing topic and grid details into one question when needed.
  - For clarification, copy the supplied requestId; use an empty string if none was supplied. Never invent a requestId.
  - Example when both topic and grid size are missing: { "result": { "status": "needs_clarification", "requestId": "", "question": "What topic should the AAC board cover, and how many rows and columns should it have (rows x columns)?" } }.
  - Only when the topic and both valid grid dimensions are available, return { "result": { "status": "success", "board": <board draft> } }. Match the supplied topic and grid size. Do not include question or requestId in a successful result.

  Board and layout:
  - Set a meaningful name and locale matching the user's language; use "en" when unspecified.
  - Honor the requested grid dimensions. Rows and columns must be positive integers.
  - The buttons array defines display order: left to right across each row, then top to bottom. Do not sort or remap buttons separately. Do not exceed grid.rows * grid.columns buttons.
  - Do not output any IDs, image_id, format, grid.order, or board-level images array. The application will assign IDs and format and derive grid order during post-processing.

  Buttons and actions:
  - Use short, meaningful labels suited to the user's communication needs. Every button must have a non-empty label, including buttons with images.
  - For ordinary communication buttons, use actions such as ["&Hello"] to insert and speak the word or phrase. Use +text for raw text insertion without automatic spacing or speech.
  - Actions are behavior strings, never objects or identifiers. Do not generate IDs or put board, button, or image IDs into action or actions. Prefer actions and leave action null; do not duplicate the same action in both fields.
  - Supported commands include :home, :back, :return, :clear, :backspace, and :speak. Use commands only when appropriate; :speak reads the composed sentence, not the button label.
  - Set vocalization only when the spoken phrase should differ from the inserted text or label. Speech uses vocalization first, then &text actions, then label.

  Images and linked boards:
  - Put each image request directly in its button's image field as { "search_keyword": "..." }. Use image: null for a button that needs no image.
  - search_keyword is the query the application will later send to a vector database to retrieve an image. Describe what the desired image depicts: its subject, action, or state, such as "glass of water" or "person waving hello".
  - Choose a concise, specific visual description that conveys this button's meaning, not a generic word such as "image" or "icon". No existing asset needs to be known or verified to propose a search query.
  - Do not supply resolved symbols, asset names, filenames, URLs, data URIs, content_type, license, width, or height. The application will resolve the image and fill its metadata after vector search.
  - Use load_board only for a supplied destination name or path; otherwise set it to null. Do not invent destinations or encode destination IDs in actions.

  Presentation and final checks:
  - Prefer readable labels and high-contrast colors. Valid font_size values are tiny, small, medium, large, huge, and giant; the default is medium.
  - Use array order for layout. Leave top and left null unless explicitly needed; supplied relative coordinates must be between 0 and 1. Do not output width or height on buttons.
  - Leave unused optional values null or use schema defaults. Keep description_html null unless requested; never include scripts, event handlers, or external resources.
  - Before returning, check grid dimensions, array order, each button's own image query, and action strings. Do not add fields outside the schema.
  `;
