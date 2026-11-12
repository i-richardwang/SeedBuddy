const ZOOM_MIN = 0.05;
const ZOOM_MAX = 6;
const ZOOM_STEP = 1.15;
const FIT_SLOP = 0.02;

let dishes = [];
let at = 0;
let viewed = 0;
let filter = "all";
let query = "";
// The view is held in the pixels of the dish's first photograph. Each
// photograph is drawn through its own alignment onto that one, so a seed
// stays where it is when another photograph of the dish is brought up.
let scale = 1;
let tx = 0;
let ty = 0;
let fitted = false;
let drag = null;

const stage = document.getElementById("stage");
const note = document.getElementById("note");
const notice = document.getElementById("notice");

function countText(shot) {
  return shot.reason || "seeds can be counted";
}

function focusText(dish, k) {
  if (dish.shots.length === 1) return "";
  const sharpness = dish.shots[k].sharpness;
  if (sharpness === null) return "focus not compared";
  if (k === 0) return "sharpest";
  const softer = Math.round((1 - Math.exp(sharpness)) * 100);
  return softer > 0 ? `${softer}% softer` : "as sharp";
}

function accepted(dish) {
  const decision = dish.decision;
  return !!decision && decision.shot === 0 && decision.suitable === dish.shots[0].suitable;
}

function changed(dish) {
  return !!dish.decision && !accepted(dish);
}

function standing(dish) {
  const decision = dish.decision;
  if (!decision) return { label: "unconfirmed", tone: "" };
  if (decision.suitable === null) return { label: "not sure", tone: "warning" };
  return decision.suitable
    ? { label: "can be counted", tone: "success" }
    : { label: "cannot be counted", tone: "error" };
}

function shown(dish) {
  const wanted = query.trim().toLowerCase();
  if (wanted && !dish.shots.some((shot) => shot.name.toLowerCase().includes(wanted))) return false;
  const decision = dish.decision;
  if (filter === "unconfirmed") return !decision;
  if (filter === "doubtful") return dish.doubtful;
  if (filter === "changed") return changed(dish);
  if (filter === "not-sure") return !!decision && decision.suitable === null;
  return true;
}

function row(thumb, name, meta, tag) {
  const item = document.createElement("li");
  const img = document.createElement("img");
  img.src = thumb;
  img.alt = "";
  const text = document.createElement("div");
  const title = document.createElement("div");
  title.className = "name";
  title.textContent = name;
  const detail = document.createElement("div");
  detail.className = "meta";
  detail.textContent = meta;
  text.append(title, detail);
  if (tag) {
    const mark = document.createElement("span");
    mark.className = "tag " + tag.tone;
    mark.textContent = tag.label;
    text.append(mark);
  }
  item.append(img, text);
  return item;
}

function renderShots(dish) {
  const list = document.getElementById("shots");
  list.replaceChildren();
  dish.shots.forEach((shot, k) => {
    const meta = [focusText(dish, k), countText(shot)].filter(Boolean).join(" · ");
    const chosen = dish.decision && dish.decision.shot === k;
    const item = row(`/thumb/${dish.index}/${k}`, shot.name, meta, chosen ? { label: "chosen", tone: "" } : null);
    if (k === viewed) item.className = "current";
    item.onclick = () => view(k);
    list.append(item);
  });
}

function renderChoice(dish) {
  const decision = dish.decision;
  document.getElementById("accept").setAttribute("aria-pressed", accepted(dish) ? "true" : "false");
  for (const button of document.querySelectorAll("#choice button[data-suitable]")) {
    const pressed = !!decision && decision.shot === viewed
      && String(decision.suitable) === button.dataset.suitable;
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
  }
}

function renderList() {
  const list = document.getElementById("list");
  list.replaceChildren();
  for (const dish of dishes.filter(shown)) {
    const used = dish.decision ? dish.decision.shot : 0;
    const count = dish.shots.length > 1 ? `${dish.shots.length} photographs` : "";
    const meta = [count, countText(dish.shots[0])].filter(Boolean).join(" · ");
    const item = row(`/thumb/${dish.index}/${used}`, dish.shots[used].name, meta, standing(dish));
    if (dish.index === at) item.className = "current";
    item.onclick = () => show(dish.index);
    list.append(item);
  }
  list.querySelector(".current")?.scrollIntoView({ block: "nearest" });
  const confirmed = dishes.filter((dish) => dish.decision).length;
  const corrected = dishes.filter(changed).length;
  document.getElementById("count").textContent =
    `${confirmed} confirmed of ${dishes.length}` + (corrected ? `, ${corrected} changed` : "");
}

function render() {
  const dish = dishes[at];
  renderShots(dish);
  renderChoice(dish);
  renderList();
}

function show(next) {
  const dish = dishes[next];
  if (!dish) return;
  at = next;
  viewed = dish.decision ? dish.decision.shot : 0;
  fitted = false;
  stage.replaceChildren(...dish.shots.map((shot, k) => {
    const img = new Image();
    img.alt = shot.name;
    img.draggable = false;
    img.classList.toggle("viewed", k === viewed);
    img.addEventListener("load", () => {
      if (img.isConnected && k === viewed && !fitted) fit();
    });
    img.src = `/photo/${dish.index}/${k}`;
    return img;
  }));
  note.value = dish.decision ? dish.decision.note : "";
  location.hash = String(at);
  const following = dishes[at + 1];
  if (following) new Image().src = `/photo/${following.index}/0`;
  render();
}

function view(k) {
  const shots = dishes[at].shots;
  viewed = (k + shots.length) % shots.length;
  [...stage.children].forEach((img, i) => img.classList.toggle("viewed", i === viewed));
  if (fitted) applyTransform();
  else fit();
  render();
}

function move(step) {
  const rows = dishes.filter(shown);
  if (!rows.length) return;
  const here = rows.findIndex((dish) => dish.index === at);
  const start = here < 0 ? 0 : here;
  show(rows[Math.min(rows.length - 1, Math.max(0, start + step))].index);
}

function nextOpen() {
  for (let step = 1; step <= dishes.length; step++) {
    const dish = dishes[(at + step) % dishes.length];
    if (!dish.decision && shown(dish)) {
      show(dish.index);
      return;
    }
  }
}

function showEmpty(data) {
  document.getElementById("count").textContent = data.skipped
    ? `${data.skipped} skipped, none to review`
    : "No photographs";
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  notice.hidden = response.ok;
  if (!response.ok) return false;
  dishes = (await response.json()).dishes;
  const decision = dishes[at].decision;
  note.value = decision ? decision.note : "";
  render();
  return true;
}

function write(shot, suitable, advance) {
  post("/api/dishes/" + at, { shot, suitable, note: note.value }).then((ok) => {
    if (ok && advance) nextOpen();
  });
}

function toggle(shot, suitable) {
  const decision = dishes[at].decision;
  if (decision && decision.shot === shot && decision.suitable === suitable) {
    post("/api/dishes/" + at, { clear: true });
    return;
  }
  write(shot, suitable, true);
}

function alignment(k) {
  const [[a, b, e], [c, d, f]] = dishes[at].shots[k].alignment;
  return { a, b, c, d, e, f };
}

function applyTransform() {
  [...stage.children].forEach((img, k) => {
    const { a, b, c, d, e, f } = alignment(k);
    img.style.transform =
      `matrix(${scale * a}, ${scale * c}, ${scale * b}, ${scale * d}, ${scale * e + tx}, ${scale * f + ty})`;
  });
  document.getElementById("zoom").textContent = Math.round(scale * magnification() * 100) + "%";
}

function magnification() {
  const { a, c } = alignment(viewed);
  return Math.hypot(a, c);
}

function fitting() {
  const img = stage.children[viewed];
  if (!img || !img.naturalWidth) return null;
  const { a, b, c, d, e, f } = alignment(viewed);
  const corners = [[0, 0], [img.naturalWidth, 0], [0, img.naturalHeight], [img.naturalWidth, img.naturalHeight]];
  const xs = corners.map(([x, y]) => a * x + b * y + e);
  const ys = corners.map(([x, y]) => c * x + d * y + f);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  const whole = Math.min(stage.clientWidth / width, stage.clientHeight / height);
  return {
    scale: whole,
    tx: (stage.clientWidth - width * whole) / 2 - left * whole,
    ty: (stage.clientHeight - height * whole) / 2 - top * whole,
  };
}

function fit() {
  const target = fitting();
  if (!target) return;
  ({ scale, tx, ty } = target);
  fitted = true;
  applyTransform();
}

function zoomAt(mx, my, next) {
  next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  const ratio = next / scale;
  tx = mx - (mx - tx) * ratio;
  ty = my - (my - ty) * ratio;
  scale = next;
  applyTransform();
}

function endDrag() {
  drag = null;
  stage.classList.remove("dragging");
}

function addressed() {
  const wanted = Number(location.hash.slice(1) || NaN);
  return Number.isInteger(wanted) && dishes[wanted] ? wanted : null;
}

stage.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = stage.getBoundingClientRect();
  const step = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  zoomAt(event.clientX - rect.left, event.clientY - rect.top, scale * step);
}, { passive: false });
stage.addEventListener("pointerdown", (event) => {
  drag = { x: event.clientX, y: event.clientY, tx, ty };
  stage.classList.add("dragging");
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener("pointermove", (event) => {
  if (!drag) return;
  tx = drag.tx + event.clientX - drag.x;
  ty = drag.ty + event.clientY - drag.y;
  applyTransform();
});
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);
stage.addEventListener("dblclick", (event) => {
  const target = fitting();
  if (target && Math.abs(scale - target.scale) < FIT_SLOP * target.scale) {
    const rect = stage.getBoundingClientRect();
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, 1 / magnification());
  } else {
    fit();
  }
});

document.getElementById("fit").onclick = fit;
document.getElementById("actual").onclick = () =>
  zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / magnification());
document.getElementById("prev").onclick = () => move(-1);
document.getElementById("next").onclick = () => move(1);
document.getElementById("choice").onclick = (event) => {
  const button = event.target.closest("button");
  const dish = dishes[at];
  if (!button || !dish) return;
  if (button.id === "accept") toggle(0, dish.shots[0].suitable);
  else toggle(viewed, JSON.parse(button.dataset.suitable));
};
document.getElementById("accept-all").onclick = () => {
  if (dishes.length) post("/api/accept-remaining", {});
};
note.addEventListener("change", () => {
  const decision = dishes[at]?.decision;
  if (decision) write(decision.shot, decision.suitable, false);
});
document.getElementById("q").addEventListener("input", (event) => {
  query = event.target.value;
  renderList();
});
document.getElementById("filters").onclick = (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  filter = button.dataset.filter;
  for (const other of document.querySelectorAll("#filters button")) {
    other.setAttribute("aria-pressed", other === button ? "true" : "false");
  }
  renderList();
};
window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea")) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const dish = dishes[at];
  if (!dish) return;
  if (event.key === "ArrowLeft") move(-1);
  else if (event.key === "ArrowRight") move(1);
  else if (event.key === "ArrowUp") view(viewed - 1);
  else if (event.key === "ArrowDown") view(viewed + 1);
  else if (event.key === "a") toggle(0, dish.shots[0].suitable);
  else if (event.key === "1") write(viewed, true, true);
  else if (event.key === "2") write(viewed, false, true);
  else if (event.key === "3") write(viewed, null, true);
  else if (event.key === "f") fit();
  else return;
  event.preventDefault();
});
window.addEventListener("resize", fit);
window.addEventListener("hashchange", () => {
  const wanted = addressed();
  if (wanted !== null && wanted !== at) show(wanted);
});

fetch("/api/review").then((response) => response.json()).then((data) => {
  dishes = data.dishes;
  if (!dishes.length) {
    showEmpty(data);
    return;
  }
  const pending = dishes.findIndex((dish) => !dish.decision);
  show(addressed() ?? (pending < 0 ? 0 : pending));
});
