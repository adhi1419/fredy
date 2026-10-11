/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React from 'react';
import { Line } from 'react-chartjs-2';
import type { ActiveElement, ChartEvent, ChartOptions, Plugin, TooltipItem } from 'chart.js';
import { baseChartOptions, CHART_COLORS, registerFinanceCharts } from '../../../components/cards/chartTheme.js';

registerFinanceCharts();

interface SharedCrosshairOptions {
  index?: number | null;
}

declare module 'chart.js' {
  interface PluginOptionsByType<TType> {
    sharedMonitoringCrosshair?: SharedCrosshairOptions;
  }
}

const sharedMonitoringCrosshair: Plugin<'line', SharedCrosshairOptions> = {
  id: 'sharedMonitoringCrosshair',
  afterDatasetsDraw(chart, _args, options) {
    const index = options?.index;
    if (index == null || index < 0 || !chart.chartArea) return;
    const x = chart.scales.x?.getPixelForValue(index);
    if (!Number.isFinite(x)) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.strokeStyle = CHART_COLORS.GRID_BRIGHT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const point = chart.getDatasetMeta(datasetIndex).data[index];
      if (point == null || !Number.isFinite(point.y)) return;
      ctx.beginPath();
      ctx.fillStyle = String(dataset.borderColor ?? CHART_COLORS.ACCENT);
      ctx.strokeStyle = CHART_COLORS.ELEVATED;
      ctx.lineWidth = 1.5;
      ctx.arc(x, point.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  },
};

export interface MonitoringSeries {
  label: string;
  data: number[];
  color: string;
  dash?: number[];
}

interface MonitoringChartProps {
  title: string;
  subtitle: string;
  labels: string[];
  series: MonitoringSeries[];
  sharedHoverIndex: number | null;
  selected: boolean;
  footnote?: string;
  beginAtZero?: boolean;
  xAxisLabel: string;
  yAxisLabel: string;
  onHoverIndex(index: number | null): void;
  onSelect(index: number): void;
}

/** One Monitoring graph. The parent owns hover index so all four charts draw the same crosshair. */
export default function MonitoringChart({
  title,
  subtitle,
  labels,
  series,
  sharedHoverIndex,
  selected,
  footnote,
  beginAtZero = true,
  xAxisLabel,
  yAxisLabel,
  onHoverIndex,
  onSelect,
}: MonitoringChartProps) {
  const data = React.useMemo(
    () => ({
      labels,
      datasets: series.map((item) => ({
        label: item.label,
        data: item.data,
        borderColor: item.color,
        backgroundColor: item.color,
        borderWidth: 1.8,
        borderDash: item.dash ?? [],
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.18,
        fill: false,
      })),
    }),
    [labels, series],
  );

  const options = React.useMemo<ChartOptions<'line'>>(() => {
    const base = baseChartOptions({ legend: series.length > 1 });
    return {
      ...base,
      interaction: { mode: 'index', intersect: false },
      onHover: (_event: ChartEvent, elements: ActiveElement[]) => {
        if (elements[0] != null) onHoverIndex(elements[0].index);
      },
      onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
        if (elements[0] != null) onSelect(elements[0].index);
      },
      plugins: {
        ...base.plugins,
        sharedMonitoringCrosshair: { index: sharedHoverIndex },
        tooltip: {
          ...base.plugins.tooltip,
          displayColors: false,
          callbacks: {
            title: (items: TooltipItem<'line'>[]) => items[0]?.label ?? '',
            label: (item: TooltipItem<'line'>) => `${item.dataset.label}: ${Math.round(Number(item.parsed.y))}`,
          },
        },
      },
      scales: {
        x: {
          ...base.scales.x,
          title: { display: true, text: xAxisLabel, color: CHART_COLORS.MUTED, font: { size: 9 } },
          grid: { color: CHART_COLORS.GRID, drawBorder: false },
        },
        y: {
          ...base.scales.y,
          beginAtZero,
          title: {
            display: true,
            text: yAxisLabel,
            color: CHART_COLORS.MUTED,
            font: { family: CHART_COLORS.FONT_MONO, size: 9 },
          },
          ticks: {
            ...base.scales.y.ticks,
            precision: 0,
            callback: (value: number | string) => String(Math.round(Number(value))),
          },
        },
      },
    };
  }, [beginAtZero, onHoverIndex, onSelect, series.length, sharedHoverIndex, xAxisLabel, yAxisLabel]);

  return (
    <article className={`monitoringChart${selected ? ' monitoringChart--selected' : ''}`}>
      <header className="monitoringChart__heading">
        <div>
          <h3>{title}</h3>
          <span>{subtitle}</span>
        </div>
      </header>
      <div className="monitoringChart__canvas" onMouseLeave={() => onHoverIndex(null)}>
        <Line data={data} options={options} plugins={[sharedMonitoringCrosshair]} />
      </div>
      {footnote && <p className="monitoringChart__footnote">{footnote}</p>}
    </article>
  );
}

MonitoringChart.displayName = 'MonitoringChart';
