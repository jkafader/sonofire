#!/usr/bin/env python3

"""
Generate moving average dataset from beer production data
Usage: python scripts/generate_moving_average.py -w <window_size> -o <output_file>
Example: python scripts/generate_moving_average.py -w 6 -o beer_production_6mo_avg.csv
"""

import argparse
import csv
from pathlib import Path

# Configuration
SCRIPT_DIR = Path(__file__).parent
INPUT_FILE = SCRIPT_DIR.parent / 'beer_production.csv'


def read_csv(filepath):
    """Read CSV data into a list of dictionaries"""
    data = []
    with open(filepath, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            data.append({
                'date': row['date'],
                'production': float(row['production'])
            })
    return data


def compute_moving_average(data, window_size):
    """Compute centered moving average over specified window size"""
    result = []

    for i in range(len(data)):
        # Determine window bounds (centered)
        half_window = window_size // 2
        start = max(0, i - half_window)
        end = min(len(data), start + window_size)

        # Compute average over window
        window_values = [data[j]['production'] for j in range(start, end)]
        average = sum(window_values) / len(window_values)

        result.append({
            'date': data[i]['date'],
            'production': round(average, 1)
        })

    return result


def write_csv(filepath, data):
    """Write data to CSV file"""
    with open(filepath, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['date', 'production'])
        writer.writeheader()
        writer.writerows(data)


def main():
    parser = argparse.ArgumentParser(
        description='Generate moving average dataset from beer production data'
    )
    parser.add_argument(
        '-w', '--window',
        type=int,
        required=True,
        help='Window size in months (e.g., 6 for 6-month average)'
    )
    parser.add_argument(
        '-o', '--output',
        type=str,
        required=True,
        help='Output CSV filename (e.g., beer_production_6mo_avg.csv)'
    )

    args = parser.parse_args()

    window_size = args.window
    output_file = SCRIPT_DIR.parent / args.output

    print(f'Reading input file: {INPUT_FILE}')
    data = read_csv(INPUT_FILE)
    print(f'Loaded {len(data)} data points')

    print(f'Computing {window_size}-month moving average...')
    avg_data = compute_moving_average(data, window_size)

    print(f'Writing output file: {output_file}')
    write_csv(output_file, avg_data)

    print('✅ Done! Generated moving average dataset.')
    print(f'   Input:  {len(data)} points')
    print(f'   Output: {len(avg_data)} points')
    print(f'   Window: {window_size} months')


if __name__ == '__main__':
    main()
