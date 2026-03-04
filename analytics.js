/* ================================================================
   TASKAGENT ANALYTICS MODULE
   Chart.js-powered KPI cards + Pie + Bar + Line charts
   ================================================================ */

// Chart instances (reused to avoid recreation)
let _pieChart = null;
let _barChart = null;
let _lineChart = null;

/**
 * Build last-N-days labels + daily completion counts from state.tasks.
 */
function getDailyCompletions(days) {
    days = days || 7;
    var labels = [];
    var counts = [];
    var now = Date.now();
    var DAY = 86400000;
    for (var i = days - 1; i >= 0; i--) {
        var dayStart = now - i * DAY;
        var dayEnd = dayStart + DAY;
        var d = new Date(dayStart);
        labels.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }));
        var cnt = state.tasks.filter(function (t) {
            return t.completed && t.completedAt && t.completedAt >= dayStart && t.completedAt < dayEnd;
        }).length;
        counts.push(cnt);
    }
    return { labels: labels, counts: counts };
}

/**
 * Main entry point — call after any task state change.
 * Updates KPI cards and all three charts.
 */
function updateAnalytics() {
    if (typeof Chart === 'undefined') return;

    var tasks = state.tasks;
    var total = tasks.length;
    var completed = tasks.filter(function (t) { return t.completed; }).length;
    var pending = total - completed;
    var highTasks = tasks.filter(function (t) { return t.priority === 'high'; }).length;
    var medTasks = tasks.filter(function (t) { return t.priority === 'medium'; }).length;
    var lowTasks = tasks.filter(function (t) { return t.priority === 'low'; }).length;
    var highDone = tasks.filter(function (t) { return t.priority === 'high' && t.completed; }).length;
    var medDone = tasks.filter(function (t) { return t.priority === 'medium' && t.completed; }).length;
    var lowDone = tasks.filter(function (t) { return t.priority === 'low' && t.completed; }).length;
    var rate = total > 0 ? Math.round((completed / total) * 100) : 0;

    // ── KPI cards ───────────────────────────────────────────────
    function kpi(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
    }
    kpi('kpiTotal', total);
    kpi('kpiDone', completed);
    kpi('kpiHigh', highTasks);
    kpi('kpiRate', rate + '%');

    var tooltipBase = {
        backgroundColor: 'rgba(14,14,24,0.96)',
        borderColor: 'rgba(255,255,255,0.10)',
        borderWidth: 1,
        titleColor: '#ffffff',
        bodyColor: '#b0b0c8',
        padding: 12,
        cornerRadius: 10
    };

    // ── 1. Pie / Doughnut — Completion Status ───────────────────
    var pieCanvas = document.getElementById('pieChart');
    if (pieCanvas) {
        var pieData = {
            labels: ['Completed', 'Pending'],
            datasets: [{
                data: [completed, pending],
                backgroundColor: ['rgba(0,255,178,0.82)', 'rgba(255,77,109,0.72)'],
                borderColor: ['#00ffb2', '#ff4d6d'],
                borderWidth: 2,
                hoverOffset: 10,
                hoverBorderWidth: 3
            }]
        };
        if (_pieChart) {
            _pieChart.data = pieData;
            _pieChart.update();
        } else {
            _pieChart = new Chart(pieCanvas, {
                type: 'doughnut',
                data: pieData,
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    cutout: '70%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: '#b0b0c8',
                                padding: 18,
                                font: { size: 12, weight: '600', family: 'Inter, sans-serif' },
                                usePointStyle: true,
                                pointStyleWidth: 10
                            }
                        },
                        tooltip: Object.assign({}, tooltipBase, {
                            callbacks: {
                                label: function (ctx) {
                                    return ' ' + ctx.label + ': ' + ctx.parsed + ' task' + (ctx.parsed !== 1 ? 's' : '');
                                }
                            }
                        })
                    },
                    animation: { animateRotate: true, duration: 800, easing: 'easeOutQuart' }
                }
            });
        }
    }

    // ── 2. Bar — Tasks by Priority (Total vs Completed) ─────────
    var barCanvas = document.getElementById('barChart');
    if (barCanvas) {
        var barData = {
            labels: ['\uD83D\uDD34 High', '\uD83D\uDFE1 Medium', '\uD83D\uDFE2 Low'],
            datasets: [
                {
                    label: 'Total',
                    data: [highTasks, medTasks, lowTasks],
                    backgroundColor: ['rgba(255,77,109,0.2)', 'rgba(255,183,3,0.2)', 'rgba(6,255,165,0.2)'],
                    borderColor: ['#ff4d6d', '#ffb703', '#06ffa5'],
                    borderWidth: 2, borderRadius: 8, borderSkipped: false
                },
                {
                    label: 'Done',
                    data: [highDone, medDone, lowDone],
                    backgroundColor: ['rgba(255,77,109,0.7)', 'rgba(255,183,3,0.7)', 'rgba(6,255,165,0.7)'],
                    borderColor: ['#ff4d6d', '#ffb703', '#06ffa5'],
                    borderWidth: 2, borderRadius: 8, borderSkipped: false
                }
            ]
        };
        var barOpts = {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#b0b0c8', padding: 14, font: { size: 12, weight: '600' }, usePointStyle: true }
                },
                tooltip: tooltipBase
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#b0b0c8', font: { weight: '600' } } },
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#b0b0c8', precision: 0 } }
            },
            animation: { duration: 700, easing: 'easeOutQuart' }
        };
        if (_barChart) {
            _barChart.data = barData;
            _barChart.update();
        } else {
            _barChart = new Chart(barCanvas, { type: 'bar', data: barData, options: barOpts });
        }
    }

    // ── 3. Line — Daily Completions (last 7 days) ───────────────
    var lineCanvas = document.getElementById('lineChart');
    if (lineCanvas) {
        var daily = getDailyCompletions(7);
        var lineData = {
            labels: daily.labels,
            datasets: [{
                label: 'Completed',
                data: daily.counts,
                fill: true,
                backgroundColor: function (ctx) {
                    var g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 220);
                    g.addColorStop(0, 'rgba(0,217,255,0.35)');
                    g.addColorStop(0.6, 'rgba(168,85,247,0.10)');
                    g.addColorStop(1, 'rgba(0,0,0,0)');
                    return g;
                },
                borderColor: '#00d9ff',
                borderWidth: 3,
                tension: 0.42,
                pointBackgroundColor: '#00d9ff',
                pointBorderColor: '#07070f',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 9,
                pointHoverBackgroundColor: '#00ffb2'
            }]
        };
        var lineOpts = {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: Object.assign({}, tooltipBase, {
                    callbacks: {
                        label: function (ctx) {
                            return ' ' + ctx.parsed.y + ' task' + (ctx.parsed.y !== 1 ? 's' : '') + ' completed';
                        }
                    }
                })
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#b0b0c8' } },
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#b0b0c8', precision: 0 } }
            },
            animation: { duration: 700, easing: 'easeOutQuart' }
        };
        if (_lineChart) {
            _lineChart.data = lineData;
            _lineChart.update();
        } else {
            _lineChart = new Chart(lineCanvas, { type: 'line', data: lineData, options: lineOpts });
        }
    }
}
