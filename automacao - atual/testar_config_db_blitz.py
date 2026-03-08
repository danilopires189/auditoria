#!/usr/bin/env python3
"""
Script para testar a configuração das novas tabelas DB_BLITZ
"""
import yaml
import os

def testar_config():
    """Testa se as configurações das tabelas DB_BLITZ estão corretas"""
    
    print("=== TESTANDO CONFIGURAÇÃO DB_BLITZ ===\n")
    
    # Verificar se o arquivo de configuração existe
    if not os.path.exists('config.yml'):
        print("❌ Arquivo config.yml não encontrado")
        return
    
    # Carregar configuração
    with open('config.yml', 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)
    
    # Verificar se as tabelas foram adicionadas
    tables = config.get('tables', {})
    
    print("📋 Tabelas configuradas:")
    for table_name in tables.keys():
        print(f"  - {table_name}")
    
    print("\n" + "="*50)
    
    # Verificar especificamente as tabelas do DB_BLITZ
    blitz_tables = ['db_conf_blitz', 'db_div_blitz']
    
    for table_name in blitz_tables:
        if table_name in tables:
            print(f"\n✅ {table_name.upper()} configurada:")
            table_config = tables[table_name]
            
            print(f"  Arquivo: {table_config.get('file')}")
            print(f"  Aba: {table_config.get('sheet')}")
            print(f"  Modo: {table_config.get('mode')}")
            print(f"  Chaves únicas: {table_config.get('unique_keys')}")
            print(f"  Colunas obrigatórias: {table_config.get('required_columns')}")
            
            # Verificar tipos de dados
            types = table_config.get('types', {})
            print(f"  Tipos de dados ({len(types)} colunas):")
            for col, tipo in types.items():
                print(f"    {col}: {tipo}")
        else:
            print(f"\n❌ {table_name.upper()} NÃO encontrada na configuração")
    
    # Verificar se o arquivo DB_BLITZ.xlsx existe
    print(f"\n" + "="*50)
    arquivo_blitz = 'data/DB_BLITZ.xlsx'
    if os.path.exists(arquivo_blitz):
        print(f"✅ Arquivo {arquivo_blitz} encontrado")
    else:
        print(f"❌ Arquivo {arquivo_blitz} NÃO encontrado")
    
    print(f"\n✅ Teste de configuração concluído!")

if __name__ == "__main__":
    testar_config()