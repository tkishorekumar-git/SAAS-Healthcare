import 'package:flutter/material.dart';

import 'features/home/home_screen.dart';

class KenishaApp extends StatelessWidget {
  const KenishaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Kenisha Healthcare',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF00796B)),
        useMaterial3: true,
      ),
      home: const HomeScreen(),
    );
  }
}
