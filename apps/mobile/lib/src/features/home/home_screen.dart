import 'package:flutter/material.dart';

import '../../config/app_config.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  static const _modules = <(String, String)>[
    ('Hospital Management', 'Appointments, OPD/IPD, billing, lab and pharmacy.'),
    ('Chronic Disease Management', 'Care plans and long-term monitoring.'),
    ('Maternal & Pregnancy Care', 'Antenatal and postnatal care journeys.'),
    ('Newborn & Pediatric Care', 'Growth and immunisation from birth to 10 years.'),
  ];

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Kenisha Healthcare')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Platform foundation', style: textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'Environment: ${AppConfig.environment}',
            style: textTheme.bodySmall,
          ),
          const SizedBox(height: 16),
          for (final (name, description) in _modules)
            Card(
              child: ListTile(
                title: Text(name),
                subtitle: Text(description),
                trailing: const Chip(label: Text('Planned')),
              ),
            ),
        ],
      ),
    );
  }
}
