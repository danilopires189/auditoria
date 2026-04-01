#!/usr/bin/env python3
"""
Script para verificar constraints no banco Supabase
Identifica se existem índices únicos necessários para upsert
"""

import psycopg2
from dotenv import load_dotenv
import os

def verificar_constraints_db_end():
    """Verifica constraints da tabela db_end no Supabase"""
    
    load_dotenv()
    
    print("=== VERIFICAÇÃO DE CONSTRAINTS DB_END ===\n")
    
    try:
        # Conectar ao Supabase
        conn = psycopg2.connect(
            host=os.getenv('SUPABASE_DB_HOST'),
            port=os.getenv('SUPABASE_DB_PORT'),
            database=os.getenv('SUPABASE_DB_NAME'),
            user=os.getenv('SUPABASE_DB_USER'),
            password=os.getenv('SUPABASE_DB_PASSWORD')
        )
        
        cursor = conn.cursor()
        
        # Verificar constraints existentes
        cursor.execute("""
            SELECT 
                tc.constraint_name,
                tc.constraint_type,
                string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
                ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_schema = 'app' 
                AND tc.table_name = 'db_end'
                AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
            GROUP BY tc.constraint_name, tc.constraint_type
            ORDER BY tc.constraint_type, tc.constraint_name
        """)
        
        constraints = cursor.fetchall()
        
        print("🔍 CONSTRAINTS EXISTENTES:")
        if constraints:
            for constraint_name, constraint_type, columns in constraints:
                print(f"  {constraint_type}: {constraint_name}")
                print(f"    Colunas: {columns}")
                print()
        else:
            print("  ❌ Nenhuma constraint única encontrada")
            print()
        
        # Verificar índices únicos
        cursor.execute("""
            SELECT 
                i.relname as index_name,
                string_agg(a.attname, ', ' ORDER BY a.attnum) as columns
            FROM pg_class i
            JOIN pg_index ix ON i.oid = ix.indexrelid
            JOIN pg_class t ON ix.indrelid = t.oid
            JOIN pg_namespace n ON t.relnamespace = n.oid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            WHERE n.nspname = 'app'
                AND t.relname = 'db_end'
                AND ix.indisunique = true
            GROUP BY i.relname
            ORDER BY i.relname
        """)
        
        indexes = cursor.fetchall()
        
        print("📊 ÍNDICES ÚNICOS:")
        if indexes:
            for index_name, columns in indexes:
                print(f"  {index_name}: {columns}")
        else:
            print("  ❌ Nenhum índice único encontrado")
        
        print()
        
        # Verificar se existe a combinação desejada
        desired_columns = ["cd", "coddv", "endereco", "andar", "validade", "tipo"]
        desired_str = ", ".join(desired_columns)
        
        found_match = False
        for constraint_name, constraint_type, columns in constraints:
            if set(columns.split(', ')) == set(desired_columns):
                found_match = True
                print(f"✅ CONSTRAINT COMPATÍVEL ENCONTRADA: {constraint_name}")
                break
        
        for index_name, columns in indexes:
            if set(columns.split(', ')) == set(desired_columns):
                found_match = True
                print(f"✅ ÍNDICE COMPATÍVEL ENCONTRADO: {index_name}")
                break
        
        if not found_match:
            print("❌ CONSTRAINT/ÍNDICE NECESSÁRIO NÃO ENCONTRADO")
            print(f"   Necessário: {desired_str}")
            print()
            print("💡 SOLUÇÕES:")
            print("   1. Usar 'full_replace' (recomendado - já configurado)")
            print("   2. Criar constraint no banco (requer acesso admin)")
            print("   3. Usar chave única mais simples")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Erro ao verificar constraints: {e}")

if __name__ == "__main__":
    verificar_constraints_db_end()