// Small SVG/HTML charts: thin marks, rounded data ends, recessive axes, hover tooltips.
import { h, s, clear, money, moneyCompact } from './core.js';

export function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 100; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const e = raw / mag;
  const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}

function barPath(x, y, w, hgt, up) {
  if (hgt <= 0.5) return '';
  const r = Math.min(4, w / 2, hgt);
  return up
    ? `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`
    : `M${x},${y}H${x + w}V${y + hgt - r}Q${x + w},${y + hgt} ${x + w - r},${y + hgt}H${x + r}Q${x},${y + hgt} ${x},${y + hgt - r}Z`;
}

function tooltip(host) {
  const tip = h('div', { class: 'tooltip hidden' });
  host.append(tip);
  return {
    show(x, y, title, rows) {
      clear(tip);
      tip.append(h('div', { class: 't-title' }, title));
      for (const r of rows) {
        tip.append(h('div', { class: 't-row' },
          h('span', null, r.color ? h('i', { class: 'key', style: { background: r.color } }) : null, r.label),
          h('b', null, r.value)));
      }
      tip.classList.remove('hidden');
      const hw = host.clientWidth, tw = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(x + 12, hw - tw))}px`;
      if (x + 12 + tw > hw) tip.style.left = `${Math.max(0, x - tw - 12)}px`;
      tip.style.top = `${Math.max(0, y - 10)}px`;
    },
    hide() { tip.classList.add('hidden'); },
  };
}

// Redraws on resize; returns nothing — the host owns the chart.
function responsive(host, draw) {
  host.classList.add('chart');
  let last = 0, raf = 0;
  const run = () => {
    const w = Math.round(host.clientWidth);
    if (!w || w === last) return;
    last = w;
    clear(host);
    draw(w);
  };
  const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); });
  ro.observe(host);
  requestAnimationFrame(run);
}

function yAxis(svg, ticks, y, m, W, fmt) {
  for (const t of ticks) {
    svg.append(s('line', { class: t === 0 ? 'base-line' : 'grid-line', x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }));
    svg.append(s('text', { class: 'tick', x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, fmt(t)));
  }
}

// Grouped columns. series: [{ name, values, color }]
export function columnChart(host, { labels, titles = labels, series, height = 260, format = money, onClick }) {
  responsive(host, (W) => {
    const H = height, m = { t: 10, r: 8, b: 26, l: 60 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vals = series.flatMap((x) => x.values);
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
    const band = iw / labels.length;
    const gap = 2;
    const barW = Math.max(3, Math.min(24, (band * 0.72 - gap * (series.length - 1)) / series.length));
    const groupW = barW * series.length + gap * (series.length - 1);
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': series.map((x) => x.name).join(' and ') + ' by month' });
    const hover = s('rect', { class: 'hover-band', x: 0, y: m.t, width: band, height: ih, visibility: 'hidden' });
    svg.append(hover);
    yAxis(svg, ticks, y, m, W, moneyCompact);
    const every = Math.max(1, Math.ceil((labels.length * 44) / iw));
    const tip = tooltip(host);
    labels.forEach((lab, i) => {
      const bx = m.l + band * i;
      const gx = bx + (band - groupW) / 2;
      series.forEach((sr, k) => {
        const v = sr.values[i];
        const x = gx + k * (barW + gap);
        const top = y(Math.max(v, 0)), bot = y(Math.min(v, 0));
        const d = barPath(x, top, barW, bot - top, v >= 0);
        if (d) svg.append(s('path', { d, fill: sr.color }));
      });
      if (i % every === 0 || i === labels.length - 1) svg.append(s('text', { class: 'tick', x: bx + band / 2, y: H - 8, 'text-anchor': 'middle' }, lab));
      const hit = s('rect', { x: bx, y: m.t, width: band, height: ih, fill: 'transparent', style: onClick ? 'cursor:pointer' : '' });
      hit.addEventListener('mouseenter', () => {
        hover.setAttribute('x', bx); hover.setAttribute('visibility', 'visible');
        tip.show(bx + band / 2, m.t, titles[i], series.map((sr) => ({ label: sr.name, value: format(sr.values[i]), color: sr.color })));
      });
      hit.addEventListener('mouseleave', () => { hover.setAttribute('visibility', 'hidden'); tip.hide(); });
      if (onClick) hit.addEventListener('click', () => onClick(i));
      svg.append(hit);
    });
    host.prepend(svg);
  });
}

// Single-series line with a 10% area wash, crosshair and end label.
export function areaChart(host, { labels, titles = labels, values, height = 240, color = 'var(--series-1)', format = money, rows }) {
  responsive(host, (W) => {
    const H = height, m = { t: 22, r: 12, b: 26, l: 64 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
    const x = (i) => m.l + (values.length === 1 ? iw / 2 : (i / (values.length - 1)) * iw);
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Trend chart' });
    yAxis(svg, ticks, y, m, W, moneyCompact);
    const pts = values.map((v, i) => `${x(i)},${y(v)}`);
    svg.append(s('path', { d: `M${x(0)},${y(0)}L${pts.join('L')}L${x(values.length - 1)},${y(0)}Z`, fill: color, 'fill-opacity': 0.1 }));
    svg.append(s('path', { d: `M${pts.join('L')}`, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const every = Math.max(1, Math.ceil((labels.length * 44) / iw));
    labels.forEach((lab, i) => {
      if (i % every === 0 || i === labels.length - 1) svg.append(s('text', { class: 'tick', x: x(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle' }, lab));
    });
    const li = values.length - 1;
    svg.append(s('circle', { cx: x(li), cy: y(values[li]), r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }));
    svg.append(s('text', { class: 'end-label', x: x(li), y: y(values[li]) - 10, 'text-anchor': 'end' }, format(values[li])));

    const cross = s('line', { class: 'crosshair', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
    const dot = s('circle', { r: 5, fill: color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' });
    svg.append(cross, dot);
    const tip = tooltip(host);
    const hit = s('rect', { x: m.l - 10, y: 0, width: iw + 20, height: H, fill: 'transparent' });
    hit.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      const i = Math.max(0, Math.min(li, Math.round(((px - m.l) / iw) * li)));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(values[i])); dot.setAttribute('visibility', 'visible');
      tip.show(x(i), m.t, titles[i], rows ? rows(i) : [{ label: 'Value', value: format(values[i]) }]);
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hide(); });
    svg.append(hit);
    host.prepend(svg);
  });
}

export function sparkline(values, { width = 160, height = 40, color = 'var(--series-1)' } = {}) {
  const min = Math.min(...values), max = Math.max(...values);
  const x = (i) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * (width - 8) + 4);
  const y = (v) => height - 4 - ((v - min) / (max - min || 1)) * (height - 8);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join('L');
  const li = values.length - 1;
  return s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' },
    s('path', { d: `M${pts}`, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    s('circle', { cx: x(li), cy: y(values[li]), r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }));
}

// Horizontal bar list. items: [{ label, value, budget?, href?, note? }]
export function barList(items, { format = money, color = 'var(--series-1)', empty = 'Nothing to show for this period.' } = {}) {
  if (!items.length) return h('div', { class: 'empty' }, empty);
  const max = Math.max(...items.map((i) => Math.max(i.value, i.budget || 0)), 1);
  const wrap = h('div', { class: 'bars' });
  for (const it of items) {
    const go = () => { if (it.href) location.hash = it.href; };
    const bar = h('div', { class: 'b-bar', style: { width: `${(it.value / max) * 100}%`, background: color } });
    const track = h('div', { class: 'b-track', title: `${it.label}: ${format(it.value)}${it.budget ? ` of ${format(it.budget)} budgeted` : ''}` }, bar);
    if (it.budget) track.append(h('div', { class: 'b-budget', style: { left: `calc(${(it.budget / max) * 100}% - 1px)` }, title: `Budget ${format(it.budget)}` }));
    wrap.append(h('div', { class: 'b-row', onclick: go },
      it.href ? h('a', { class: 'b-label', href: it.href, title: it.label }, it.label) : h('span', { class: 'b-label', title: it.label }, it.label),
      track,
      h('div', { class: 'b-val' }, format(it.value), it.note ? h('span', { class: 'muted' }, ` ${it.note}`) : null)));
  }
  return wrap;
}
